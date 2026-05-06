'use strict';

const fs = require('fs');
const { resolvePaths } = require('./paths');

const CURRENT_SCHEMA_VERSION = 1;

const DEFAULT_CONFIG = {
  $schemaVersion: CURRENT_SCHEMA_VERSION,
  users: [],
  questions: [],
  searches: [],
  defaults: {
    limit: 10,
    intervalSec: 3600,
  },
  channels: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultConfig() {
  return clone(DEFAULT_CONFIG);
}

function ensureBaseDirs() {
  const p = resolvePaths();
  fs.mkdirSync(p.base, { recursive: true });
  fs.mkdirSync(p.stateDir, { recursive: true });
  fs.mkdirSync(p.logsDir, { recursive: true });
  return p;
}

function exists() {
  try {
    fs.accessSync(resolvePaths().configFile);
    return true;
  } catch (_) {
    return false;
  }
}

function validate(config) {
  const errors = [];
  if (!config || typeof config !== 'object') errors.push('config 不是对象');
  if (config && config.$schemaVersion !== CURRENT_SCHEMA_VERSION) errors.push(`$schemaVersion 期望 ${CURRENT_SCHEMA_VERSION}`);
  for (const key of ['users', 'questions', 'searches', 'channels']) {
    if (config && config[key] && !Array.isArray(config[key])) errors.push(`${key} 必须是数组`);
  }
  (config.users || []).forEach((item, i) => {
    if (!item.userSlug && !item.url) errors.push(`users[${i}] 必须提供 userSlug 或 url`);
  });
  (config.questions || []).forEach((item, i) => {
    if (!item.questionId && !item.url) errors.push(`questions[${i}] 必须提供 questionId 或 url`);
  });
  (config.searches || []).forEach((item, i) => {
    if (!item.keyword) errors.push(`searches[${i}].keyword 必填`);
  });
  return { ok: errors.length === 0, errors };
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
  return JSON.parse(raw);
}

function loadConfig() {
  const config = Object.assign(defaultConfig(), loadConfigRaw());
  const checked = validate(config);
  if (!checked.ok) {
    const err = new Error(`monitor 配置校验失败:\n  - ${checked.errors.join('\n  - ')}`);
    err.code = 'E_MONITOR_CONFIG_INVALID';
    err.detail = checked;
    throw err;
  }
  return config;
}

function saveConfig(config) {
  ensureBaseDirs();
  const { configFile } = resolvePaths();
  const tmp = `${configFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configFile);
  return configFile;
}

function initConfig({ force = false } = {}) {
  ensureBaseDirs();
  if (exists() && !force) return { created: false, configFile: resolvePaths().configFile };
  const config = defaultConfig();
  const configFile = saveConfig(config);
  return { created: true, configFile, config };
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  defaultConfig,
  ensureBaseDirs,
  exists,
  validate,
  loadConfig,
  loadConfigRaw,
  saveConfig,
  initConfig,
};
