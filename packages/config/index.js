'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_TASK_ORIGIN_CONFIG,
  DEFAULT_TAINT_CONFIG,
  DEFAULT_PROFILE_CONFIG,
  POLICY_ENFORCEMENT_LEVELS,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  RELEASE_BASE_URL,
  SKILLS_REGISTRY_URL,
} = require('@js-eyes/protocol');
const { chmodBestEffort, ensureRuntimePaths } = require('@js-eyes/runtime-paths');

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
  security: DEFAULT_SECURITY_CONFIG,
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

function mergeSecurityConfig(...configs) {
  const base = clone(DEFAULT_SECURITY_CONFIG);
  return configs.reduce((merged, config) => {
    if (!config || typeof config !== 'object') return merged;
    const next = { ...merged, ...config };
    if (Array.isArray(config.allowedOrigins)) {
      next.allowedOrigins = Array.from(new Set([
        ...(merged.allowedOrigins || []),
        ...config.allowedOrigins,
      ]));
    }
    if (config.toolPolicies && typeof config.toolPolicies === 'object') {
      next.toolPolicies = { ...(merged.toolPolicies || {}), ...config.toolPolicies };
    }
    if (Array.isArray(config.sensitiveCookieDomains)) {
      next.sensitiveCookieDomains = Array.from(new Set([
        ...(merged.sensitiveCookieDomains || []),
        ...config.sensitiveCookieDomains,
      ]));
    }
    if (Array.isArray(config.egressAllowlist)) {
      next.egressAllowlist = Array.from(new Set([
        ...(merged.egressAllowlist || []),
        ...config.egressAllowlist,
      ]));
    }
    if (typeof config.enforcement === 'string') {
      next.enforcement = POLICY_ENFORCEMENT_LEVELS.includes(config.enforcement)
        ? config.enforcement
        : (merged.enforcement || DEFAULT_SECURITY_CONFIG.enforcement);
    }
    if (config.taskOrigin && typeof config.taskOrigin === 'object') {
      next.taskOrigin = {
        ...(merged.taskOrigin || clone(DEFAULT_TASK_ORIGIN_CONFIG)),
        ...config.taskOrigin,
        sources: Array.isArray(config.taskOrigin.sources)
          ? config.taskOrigin.sources.slice()
          : (merged.taskOrigin && Array.isArray(merged.taskOrigin.sources)
            ? merged.taskOrigin.sources.slice()
            : DEFAULT_TASK_ORIGIN_CONFIG.sources.slice()),
      };
    }
    if (config.taint && typeof config.taint === 'object') {
      next.taint = {
        ...(merged.taint || clone(DEFAULT_TAINT_CONFIG)),
        ...config.taint,
      };
    }
    if (config.profile && typeof config.profile === 'object') {
      next.profile = {
        ...(merged.profile || clone(DEFAULT_PROFILE_CONFIG)),
        ...config.profile,
      };
    }
    return next;
  }, base);
}

function normalizeConfig(config = {}) {
  return {
    ...clone(DEFAULT_CONFIG),
    ...(config || {}),
    recording: mergeRecordingConfig(config.recording),
    security: mergeSecurityConfig(config.security),
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
  chmodBestEffort(paths.configFile, 0o600);
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
  mergeSecurityConfig,
  normalizeConfig,
  parseConfigValue,
  saveConfig,
  setConfigValue,
};
