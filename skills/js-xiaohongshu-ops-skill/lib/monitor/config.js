'use strict';

/**
 * monitor config（xhs 版）
 *
 * schema v1：
 * {
 *   $schemaVersion: 1,
 *   accounts: [{ username, userId, enabled, addedAt, channels?: string[], maxPagesPerCheck? }],
 *   searches: [{ keyword, channelType?, sortBy?, contentType?, timeRange?, searchScope?, limit?,
 *               enabled, addedAt, channels?: string[] }],
 *   defaults: { summaryLength, maxPagesPerCheck, limitPerSearch },
 *   deduplication: { method, historyDays },
 *   scheduling: { intervalSec },
 *   channels: [{ name, type: 'feishu'|'discord'|'generic_webhook'|'console', url?, secret?, headers? }]
 * }
 */

const fs = require('fs');
const { resolvePaths } = require('./paths');

const CURRENT_SCHEMA_VERSION = 1;

const DEFAULT_CONFIG = {
  $schemaVersion: CURRENT_SCHEMA_VERSION,
  accounts: [],
  searches: [],
  defaults: {
    summaryLength: 100,
    maxPagesPerCheck: 1,
    limitPerSearch: 10,
  },
  deduplication: {
    method: 'id_and_hash',
    historyDays: 30,
  },
  scheduling: {
    intervalSec: 3600,
  },
  channels: [],
};

function defaultConfig() { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }

function ensureBaseDirs() {
  const p = resolvePaths();
  fs.mkdirSync(p.base, { recursive: true });
  fs.mkdirSync(p.stateDir, { recursive: true });
  fs.mkdirSync(p.logsDir, { recursive: true });
  return p;
}

function loadConfigRaw() {
  const { configFile } = resolvePaths();
  let raw;
  try { raw = fs.readFileSync(configFile, 'utf8'); }
  catch (err) {
    if (err.code === 'ENOENT') {
      const error = new Error(`monitor 未初始化，请先运行: node index.js monitor init（期望文件: ${configFile}）`);
      error.code = 'E_MONITOR_NOT_INITIALIZED';
      throw error;
    }
    throw err;
  }
  try { return JSON.parse(raw); }
  catch (err) {
    const error = new Error(`monitor 配置文件 JSON 解析失败: ${err.message}（文件: ${configFile}）`);
    error.code = 'E_MONITOR_CONFIG_PARSE';
    throw error;
  }
}

function migrate(config, fromVersion) {
  if (!config || typeof config !== 'object') return defaultConfig();
  if (!config.$schemaVersion) config.$schemaVersion = CURRENT_SCHEMA_VERSION;
  if (!Array.isArray(config.accounts)) config.accounts = [];
  if (!Array.isArray(config.searches)) config.searches = [];
  return config;
}

function validate(config) {
  const errors = [];
  if (!config || typeof config !== 'object') return { ok: false, errors: ['config 不是对象'] };
  if (config.$schemaVersion !== CURRENT_SCHEMA_VERSION) {
    errors.push(`$schemaVersion 期望 ${CURRENT_SCHEMA_VERSION}，实际 ${config.$schemaVersion}`);
  }
  if (!Array.isArray(config.accounts)) errors.push('accounts 必须是数组');
  else {
    config.accounts.forEach((a, i) => {
      if (!a || typeof a !== 'object') errors.push(`accounts[${i}] 不是对象`);
      else if (!a.username && !a.userId) errors.push(`accounts[${i}] 必须提供 username 或 userId`);
    });
  }
  if (!Array.isArray(config.searches)) errors.push('searches 必须是数组');
  else {
    config.searches.forEach((s, i) => {
      if (!s || typeof s !== 'object') errors.push(`searches[${i}] 不是对象`);
      else if (!s.keyword || typeof s.keyword !== 'string') errors.push(`searches[${i}].keyword 必填`);
    });
  }
  if (config.deduplication) {
    const m = config.deduplication.method;
    if (m && !['id_only', 'hash_only', 'id_and_hash'].includes(m)) {
      errors.push(`deduplication.method 非法: ${m}`);
    }
  }
  const ALLOWED_CHANNEL_TYPES = new Set(['feishu', 'discord', 'generic_webhook', 'console']);
  if (config.channels) {
    if (!Array.isArray(config.channels)) errors.push('channels 必须是数组');
    else {
      const seen = new Set();
      config.channels.forEach((ch, i) => {
        if (!ch || typeof ch !== 'object') { errors.push(`channels[${i}] 不是对象`); return; }
        if (!ch.name) errors.push(`channels[${i}].name 必填`);
        else if (seen.has(ch.name)) errors.push(`channels[${i}].name 重复: ${ch.name}`);
        else seen.add(ch.name);
        if (!ch.type) errors.push(`channels[${i}].type 必填`);
        else if (!ALLOWED_CHANNEL_TYPES.has(ch.type)) errors.push(`channels[${i}].type 非法: ${ch.type}`);
        if (ch.type && ch.type !== 'console' && !ch.url) errors.push(`channels[${i}].url 必填（type=${ch.type}）`);
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

function loadConfig() {
  const raw = loadConfigRaw();
  const migrated = migrate(raw);
  const { ok, errors } = validate(migrated);
  if (!ok) {
    const err = new Error(`monitor 配置校验失败:\n  - ${errors.join('\n  - ')}`);
    err.code = 'E_MONITOR_CONFIG_INVALID';
    err.detail = { errors };
    throw err;
  }
  return migrated;
}

function validateConfig(raw) {
  const migrated = migrate(raw);
  const { ok, errors } = validate(migrated);
  return { ok, errors, config: migrated };
}

function saveConfig(config) {
  ensureBaseDirs();
  const { configFile } = resolvePaths();
  const tmp = configFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configFile);
  return configFile;
}

function exists() {
  const { configFile } = resolvePaths();
  try { fs.accessSync(configFile); return true; } catch { return false; }
}

function effectiveAccountSettings(account, config) {
  const defaults = config.defaults || {};
  const globalChannelNames = (config.channels || []).map((c) => c.name);
  const channelNames = Array.isArray(account.channels) && account.channels.length > 0
    ? account.channels : globalChannelNames;
  return {
    type: 'account',
    username: account.username || account.userId,
    userId: account.userId || account.username,
    enabled: account.enabled !== false,
    summaryLength: account.summaryLength || defaults.summaryLength || 100,
    maxPagesPerCheck: account.maxPagesPerCheck || defaults.maxPagesPerCheck || 1,
    channelNames,
  };
}

function effectiveSearchSettings(search, config) {
  const defaults = config.defaults || {};
  const globalChannelNames = (config.channels || []).map((c) => c.name);
  const channelNames = Array.isArray(search.channels) && search.channels.length > 0
    ? search.channels : globalChannelNames;
  return {
    type: 'search',
    keyword: search.keyword,
    channelType: search.channelType || '全部',
    sortBy: search.sortBy || null,
    contentType: search.contentType || null,
    timeRange: search.timeRange || null,
    searchScope: search.searchScope || null,
    enabled: search.enabled !== false,
    summaryLength: search.summaryLength || defaults.summaryLength || 100,
    limit: search.limit || defaults.limitPerSearch || 10,
    channelNames,
  };
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  defaultConfig,
  ensureBaseDirs,
  loadConfig,
  loadConfigRaw,
  migrate,
  validate,
  validateConfig,
  saveConfig,
  exists,
  effectiveAccountSettings,
  effectiveSearchSettings,
};
