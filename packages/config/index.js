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
  extraSkillDirs: [],
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

function normalizeExtraSkillDirs(value) {
  if (value == null) return [];
  let list;
  if (typeof value === 'string') {
    list = value.trim() ? [value] : [];
  } else if (Array.isArray(value)) {
    list = value;
  } else {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[js-eyes/config] extraSkillDirs 必须是字符串数组，已忽略：', value);
    }
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeConfig(config = {}) {
  return {
    ...clone(DEFAULT_CONFIG),
    ...(config || {}),
    recording: mergeRecordingConfig(config.recording),
    security: mergeSecurityConfig(config.security),
    extraSkillDirs: normalizeExtraSkillDirs(config ? config.extraSkillDirs : undefined),
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

// Fields in `security` that may be swapped at runtime without restarting the
// server. Changing any other `security.*` field is recorded under `ignored` and
// requires a restart to take effect (see `packages/server-core/index.js` →
// reloadSecurity).
const HOT_RELOADABLE_SECURITY_KEYS = Object.freeze([
  'egressAllowlist',
  'toolPolicies',
  'sensitiveCookieDomains',
  'allowedOrigins',
  'enforcement',
]);

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

function computeHostDiff(prevList, nextList) {
  const prev = Array.isArray(prevList) ? prevList.slice() : [];
  const next = Array.isArray(nextList) ? nextList.slice() : [];
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const added = next.filter((h) => !prevSet.has(h));
  const removed = prev.filter((h) => !nextSet.has(h));
  return { added, removed };
}

/**
 * Diff two resolved `security` objects and split the result by hot-reload safety.
 *
 * @param {object} nextSecurity resolved via `resolveSecurityConfig(loadConfig())`
 * @param {object} prevSecurity current `state.security`
 * @returns {{ applied: object, ignored: object, egressDiff: {added: string[], removed: string[]} }}
 *   - `applied`: subset of `nextSecurity` whose values differ from `prevSecurity`
 *     and belong to {@link HOT_RELOADABLE_SECURITY_KEYS}.
 *   - `ignored`: map of `{ key: { before, after } }` for fields that differ but
 *     are NOT in the hot-reloadable whitelist — the caller should log/audit and
 *     tell the user a restart is needed.
 *   - `egressDiff`: convenience summary of egress host additions/removals (empty
 *     arrays when `egressAllowlist` is unchanged).
 */
function resolveHotReloadableSecurity(nextSecurity, prevSecurity) {
  const prev = prevSecurity || {};
  const next = nextSecurity || {};

  const applied = {};
  const ignored = {};

  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (deepEqual(prev[key], next[key])) continue;
    if (HOT_RELOADABLE_SECURITY_KEYS.includes(key)) {
      applied[key] = next[key];
    } else {
      ignored[key] = { before: prev[key], after: next[key] };
    }
  }

  const egressDiff = computeHostDiff(prev.egressAllowlist, next.egressAllowlist);

  return { applied, ignored, egressDiff };
}

module.exports = {
  DEFAULT_CONFIG,
  DEFAULT_RECORDING_CONFIG,
  HOT_RELOADABLE_SECURITY_KEYS,
  getConfigValue,
  loadConfig,
  mergeRecordingConfig,
  mergeSecurityConfig,
  normalizeConfig,
  parseConfigValue,
  resolveHotReloadableSecurity,
  saveConfig,
  setConfigValue,
};
