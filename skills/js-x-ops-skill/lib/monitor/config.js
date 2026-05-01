'use strict';

/**
 * monitor config
 *
 * schema v1：
 * {
 *   $schemaVersion: 1,
 *   accounts: [{ username, enabled, addedAt, channels?: string[] }],
 *   defaults: { includeRetweets, includeReplies, summaryLength, maxPagesPerCheck, minLikes },
 *   deduplication: { method: 'id_only'|'hash_only'|'id_and_hash', historyDays },
 *   scheduling: { intervalSec },
 *   channels: [{ name, type: 'feishu'|'discord'|'generic_webhook'|'console', url?, secret?, template? }]
 * }
 */

const fs = require('fs');
const path = require('path');
const { resolvePaths } = require('./paths');

const CURRENT_SCHEMA_VERSION = 1;

const DEFAULT_CONFIG = {
  $schemaVersion: CURRENT_SCHEMA_VERSION,
  accounts: [],
  defaults: {
    includeRetweets: false,
    includeReplies: false,
    summaryLength: 100,
    maxPagesPerCheck: 1,
    minLikes: 0,
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

function defaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

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
  try {
    raw = fs.readFileSync(configFile, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      const error = new Error(`monitor 未初始化，请先运行: node index.js monitor init（期望文件: ${configFile}）`);
      error.code = 'E_MONITOR_NOT_INITIALIZED';
      throw error;
    }
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const error = new Error(`monitor 配置文件 JSON 解析失败: ${err.message}（文件: ${configFile}）`);
    error.code = 'E_MONITOR_CONFIG_PARSE';
    throw error;
  }
}

/**
 * Migrate older schema versions up to current. Only v1 for now.
 */
function migrate(config) {
  if (!config || typeof config !== 'object') return defaultConfig();
  if (!config.$schemaVersion) {
    config.$schemaVersion = CURRENT_SCHEMA_VERSION;
  }
  return config;
}

function validate(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: ['config 不是对象'] };
  }
  if (config.$schemaVersion !== CURRENT_SCHEMA_VERSION) {
    errors.push(`$schemaVersion 期望 ${CURRENT_SCHEMA_VERSION}，实际 ${config.$schemaVersion}`);
  }
  if (!Array.isArray(config.accounts)) errors.push('accounts 必须是数组');
  else {
    config.accounts.forEach((a, i) => {
      if (!a || typeof a !== 'object') errors.push(`accounts[${i}] 不是对象`);
      else if (!a.username || typeof a.username !== 'string') errors.push(`accounts[${i}].username 必填`);
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
      const seenNames = new Set();
      config.channels.forEach((ch, i) => {
        if (!ch || typeof ch !== 'object') { errors.push(`channels[${i}] 不是对象`); return; }
        if (!ch.name) errors.push(`channels[${i}].name 必填`);
        else if (seenNames.has(ch.name)) errors.push(`channels[${i}].name 重复: ${ch.name}`);
        else seenNames.add(ch.name);
        if (!ch.type) errors.push(`channels[${i}].type 必填`);
        else if (!ALLOWED_CHANNEL_TYPES.has(ch.type)) errors.push(`channels[${i}].type 非法: ${ch.type}（允许: ${Array.from(ALLOWED_CHANNEL_TYPES).join('|')}）`);
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

/**
 * 校验外部（比如 moltbook）在内存里拼好的 config，返回 { ok, errors, config }。
 * 与 loadConfig 的区别：不读文件、不抛错，但同样跑 migrate + validate，
 * 方便第三方在调用 runCheckCore({ config }) 前就把 schema 问题暴露出来。
 *
 * @param {Object} raw
 * @returns {{ ok: boolean, errors: string[], config: Object }}
 */
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

/**
 * 合并账号级设置与全局 defaults；账号级 channels 覆盖全局 channels 名单。
 */
function effectiveAccountSettings(account, config) {
  const defaults = config.defaults || {};
  const globalChannelNames = (config.channels || []).map((c) => c.name);
  const channelNames = Array.isArray(account.channels) && account.channels.length > 0
    ? account.channels
    : globalChannelNames;
  return {
    username: account.username,
    enabled: account.enabled !== false,
    includeRetweets: account.includeRetweets != null ? !!account.includeRetweets : !!defaults.includeRetweets,
    includeReplies: account.includeReplies != null ? !!account.includeReplies : !!defaults.includeReplies,
    summaryLength: account.summaryLength || defaults.summaryLength || 100,
    maxPagesPerCheck: account.maxPagesPerCheck || defaults.maxPagesPerCheck || 1,
    minLikes: account.minLikes || defaults.minLikes || 0,
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
};
