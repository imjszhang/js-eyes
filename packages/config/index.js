'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  RELEASE_BASE_URL,
  SKILLS_REGISTRY_URL,
} = require('@js-eyes/protocol');
const { ensureRuntimePaths } = require('@js-eyes/runtime-paths');

const DEFAULT_RECORDING_CONFIG = {
  mode: 'standard',
  baseDir: '',
  cacheTtlMinutes: 60,
  saveRawHtml: false,
  maxDebugBundles: 10,
};

const DEFAULT_CONFIG = {
  serverHost: DEFAULT_SERVER_HOST,
  serverPort: DEFAULT_SERVER_PORT,
  requestTimeout: DEFAULT_REQUEST_TIMEOUT_SECONDS,
  autoStartServer: true,
  skillsRegistryUrl: SKILLS_REGISTRY_URL,
  skillsDir: '',
  skillsEnabled: {},
  extensionsBaseUrl: RELEASE_BASE_URL,
  recording: DEFAULT_RECORDING_CONFIG,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeRecordingConfig(...configs) {
  return configs.reduce((merged, config) => ({
    ...merged,
    ...(config || {}),
  }), clone(DEFAULT_RECORDING_CONFIG));
}

function normalizeConfig(config = {}) {
  return {
    ...clone(DEFAULT_CONFIG),
    ...(config || {}),
    recording: mergeRecordingConfig(config.recording),
  };
}

function loadConfig(options = {}) {
  const paths = ensureRuntimePaths(options);
  let fileConfig = {};

  if (fs.existsSync(paths.configFile)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(paths.configFile, 'utf8'));
    } catch (error) {
      throw new Error(`无法解析配置文件 ${paths.configFile}: ${error.message}`);
    }
  }

  return normalizeConfig(fileConfig);
}

function saveConfig(config, options = {}) {
  const paths = ensureRuntimePaths(options);
  const nextConfig = normalizeConfig(config);
  fs.writeFileSync(paths.configFile, JSON.stringify(nextConfig, null, 2) + '\n', 'utf8');
  return nextConfig;
}

function getConfigValue(key, options = {}) {
  const config = loadConfig(options);
  if (!key) {
    return config;
  }

  return key.split('.').reduce((value, segment) => {
    if (value && Object.prototype.hasOwnProperty.call(value, segment)) {
      return value[segment];
    }
    return undefined;
  }, config);
}

function setConfigValue(key, value, options = {}) {
  if (!key) {
    throw new Error('配置键不能为空');
  }

  const config = loadConfig(options);
  const segments = key.split('.');
  let cursor = config;

  while (segments.length > 1) {
    const segment = segments.shift();
    if (!cursor[segment] || typeof cursor[segment] !== 'object') {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  cursor[segments[0]] = value;
  return saveConfig(config, options);
}

function parseConfigValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw === 'undefined') return undefined;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

module.exports = {
  DEFAULT_CONFIG,
  DEFAULT_RECORDING_CONFIG,
  getConfigValue,
  loadConfig,
  mergeRecordingConfig,
  normalizeConfig,
  parseConfigValue,
  saveConfig,
  setConfigValue,
};
