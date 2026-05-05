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

// v3.1 PR-C3 schema v2 草案（仅当 B1 长跑报告确认需要才启用）：
//   - groups: [{ name, accounts:[id], searches:[kw], priority }]   多目标聚合 / 优先级
//   - account/search.priority: 'low' | 'normal' | 'high'
//   - defaults.notify: { dedupWindow: <秒> }                       通知层去重窗口
// migrate 钩子已就位（migrateV1ToV2），但默认不强制启用，保持 CURRENT_SCHEMA_VERSION=1。
const SCHEMA_V2_DRAFT = 2;
const VALID_PRIORITIES = new Set(['low', 'normal', 'high']);

function migrateV1ToV2(config) {
  const out = config && typeof config === 'object' ? config : {};
  out.$schemaVersion = SCHEMA_V2_DRAFT;
  if (!Array.isArray(out.groups)) out.groups = [];
  if (Array.isArray(out.accounts)) {
    out.accounts = out.accounts.map((a) => Object.assign({ priority: 'normal' }, a, {
      priority: a && VALID_PRIORITIES.has(a.priority) ? a.priority : 'normal',
    }));
  }
  if (Array.isArray(out.searches)) {
    out.searches = out.searches.map((s) => Object.assign({ priority: 'normal' }, s, {
      priority: s && VALID_PRIORITIES.has(s.priority) ? s.priority : 'normal',
    }));
  }
  out.defaults = Object.assign({}, out.defaults || {});
  if (!out.defaults.notify || typeof out.defaults.notify !== 'object') {
    out.defaults.notify = { dedupWindow: 0 };
  } else if (typeof out.defaults.notify.dedupWindow !== 'number') {
    out.defaults.notify.dedupWindow = 0;
  }
  return out;
}

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
  // v1 → v2 迁移仅当显式开启时执行（环境变量 / fromVersion 显式给 1 + targetVersion 给 2）
  const enableV2 = process.env.JS_XHS_MONITOR_SCHEMA_V2 === '1';
  if (enableV2 && (config.$schemaVersion === 1 || fromVersion === 1)) {
    return migrateV1ToV2(config);
  }
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
    // 监控长跑保守默认 false；用户可在 monitor config 的 search 项里显式 extractDetails:true 启用。
    extractDetails: search.extractDetails === true,
    detailsLimit: search.detailsLimit ? Number(search.detailsLimit) : null,
    channelNames,
  };
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_V2_DRAFT,
  defaultConfig,
  ensureBaseDirs,
  loadConfig,
  loadConfigRaw,
  migrate,
  migrateV1ToV2,
  validate,
  validateConfig,
  saveConfig,
  exists,
  effectiveAccountSettings,
  effectiveSearchSettings,
};
