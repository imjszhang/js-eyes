'use strict';

const pkg = require('./package.json');

const DEFAULT_SERVER_HOST = 'localhost';
const DEFAULT_SERVER_PORT = 18080;
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 60;
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_SECONDS * 1000;
const PROTOCOL_VERSION = '1.0';
const PACKAGE_VERSION = pkg.version;
const SKILLS_REGISTRY_URL = 'https://js-eyes.com/skills.json';
const RELEASE_BASE_URL = 'https://github.com/imjszhang/js-eyes/releases/download';

const FORWARDABLE_ACTIONS = [
  'open_url',
  'close_tab',
  'get_html',
  'execute_script',
  'inject_css',
  'get_cookies',
  'get_cookies_by_domain',
  'get_page_info',
  'upload_file_to_tab',
];

const SENSITIVE_TOOL_NAMES = Object.freeze([
  'js_eyes_execute_script',
  'js_eyes_get_cookies',
  'js_eyes_get_cookies_by_domain',
  'js_eyes_inject_css',
  'js_eyes_upload_file',
  'js_eyes_upload_file_to_tab',
  'js_eyes_install_skill',
]);

const LOOPBACK_HOSTS = Object.freeze(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']);

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'chrome-extension://*',
  'moz-extension://*',
  'http://localhost',
  'https://localhost',
  'http://127.0.0.1',
  'https://127.0.0.1',
  'http://[::1]',
  'https://[::1]',
]);

const DEFAULT_TASK_ORIGIN_CONFIG = Object.freeze({
  enabled: true,
  sources: ['user-message', 'skill-platforms', 'active-tab', 'fetched-links'],
});

const DEFAULT_TAINT_CONFIG = Object.freeze({
  enabled: true,
  mode: 'canary+substring',
  minValueLength: 6,
});

const DEFAULT_PROFILE_CONFIG = Object.freeze({
  default: 'full',
});

const POLICY_ENFORCEMENT_LEVELS = Object.freeze(['off', 'soft', 'strict']);

const DEFAULT_SECURITY_CONFIG = Object.freeze({
  allowAnonymous: false,
  allowedOrigins: DEFAULT_ALLOWED_ORIGINS.slice(),
  allowRemoteBind: false,
  allowRawEval: false,
  requireLockfile: true,
  enforcement: 'soft',
  taskOrigin: { ...DEFAULT_TASK_ORIGIN_CONFIG, sources: DEFAULT_TASK_ORIGIN_CONFIG.sources.slice() },
  egressAllowlist: [],
  taint: { ...DEFAULT_TAINT_CONFIG },
  profile: { ...DEFAULT_PROFILE_CONFIG },
  toolPolicies: {
    js_eyes_execute_script: 'confirm',
    js_eyes_get_cookies: 'confirm',
    js_eyes_get_cookies_by_domain: 'confirm',
    js_eyes_inject_css: 'confirm',
    js_eyes_upload_file: 'confirm',
    js_eyes_upload_file_to_tab: 'confirm',
    js_eyes_install_skill: 'confirm',
  },
  sensitiveCookieDomains: [
    'bank',
    'paypal.com',
    'google.com',
    'live.com',
    'apple.com',
    'icloud.com',
    'aws.amazon.com',
    'amazon.com',
    'office.com',
    'microsoft.com',
    'github.com',
  ],
});

const WS_CLOSE_CODE_AUTH_REQUIRED = 4401;
const WS_CLOSE_CODE_FORBIDDEN_ORIGIN = 4403;

const COMPATIBILITY_MATRIX = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  cliVersion: PACKAGE_VERSION,
  extensionVersion: PACKAGE_VERSION,
  serverCoreVersion: PACKAGE_VERSION,
  clientSdkVersion: PACKAGE_VERSION,
  openclawPluginVersion: PACKAGE_VERSION,
  skillClientSdkVersion: PACKAGE_VERSION,
});

function isLoopbackHost(host) {
  if (!host) return false;
  const normalized = String(host).toLowerCase();
  if (LOOPBACK_HOSTS.includes(normalized)) return true;
  if (normalized.startsWith('127.')) return true;
  if (normalized === '::ffff:127.0.0.1') return true;
  return false;
}

function normalizeOriginPattern(pattern) {
  if (!pattern) return null;
  const trimmed = String(pattern).trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, '');
}

function matchesOriginPattern(origin, pattern) {
  if (!origin || !pattern) return false;
  const normOrigin = String(origin).trim().toLowerCase().replace(/\/$/, '');
  const normPattern = normalizeOriginPattern(pattern);
  if (!normPattern) return false;
  if (normPattern === '*') return true;
  if (normPattern.endsWith('://*')) {
    const scheme = normPattern.slice(0, -3);
    return normOrigin.startsWith(scheme);
  }
  if (normPattern.includes('*')) {
    const regex = new RegExp(
      '^' + normPattern.split('*').map(escapeRegex).join('.*') + '$',
    );
    return regex.test(normOrigin);
  }
  if (normOrigin === normPattern) return true;
  if (normOrigin.startsWith(normPattern + ':')) return true;
  if (normOrigin.startsWith(normPattern + '/')) return true;
  return false;
}

function escapeRegex(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!Array.isArray(allowedOrigins)) return false;
  for (const pattern of allowedOrigins) {
    if (matchesOriginPattern(origin, pattern)) return true;
  }
  return false;
}

function resolveSecurityConfig(config = {}) {
  const raw = (config && config.security && typeof config.security === 'object')
    ? config.security
    : {};
  const merged = {
    ...DEFAULT_SECURITY_CONFIG,
    ...raw,
    allowedOrigins: Array.isArray(raw.allowedOrigins) && raw.allowedOrigins.length
      ? Array.from(new Set([
        ...DEFAULT_SECURITY_CONFIG.allowedOrigins,
        ...raw.allowedOrigins,
      ]))
      : DEFAULT_SECURITY_CONFIG.allowedOrigins.slice(),
    toolPolicies: {
      ...DEFAULT_SECURITY_CONFIG.toolPolicies,
      ...(raw.toolPolicies || {}),
    },
    sensitiveCookieDomains: Array.isArray(raw.sensitiveCookieDomains)
      ? raw.sensitiveCookieDomains.slice()
      : DEFAULT_SECURITY_CONFIG.sensitiveCookieDomains.slice(),
    enforcement: POLICY_ENFORCEMENT_LEVELS.includes(raw.enforcement)
      ? raw.enforcement
      : DEFAULT_SECURITY_CONFIG.enforcement,
    taskOrigin: mergeTaskOriginConfig(raw.taskOrigin),
    egressAllowlist: Array.isArray(raw.egressAllowlist)
      ? raw.egressAllowlist.slice()
      : DEFAULT_SECURITY_CONFIG.egressAllowlist.slice(),
    taint: mergeTaintConfig(raw.taint),
    profile: mergeProfileConfig(raw.profile),
  };
  if (process.env.JS_EYES_INSECURE === '1') {
    merged.allowAnonymous = true;
  }
  if (process.env.JS_EYES_ALLOW_REMOTE_BIND === '1') {
    merged.allowRemoteBind = true;
  }
  if (process.env.JS_EYES_POLICY_ENFORCEMENT && POLICY_ENFORCEMENT_LEVELS.includes(process.env.JS_EYES_POLICY_ENFORCEMENT)) {
    merged.enforcement = process.env.JS_EYES_POLICY_ENFORCEMENT;
  }
  return merged;
}

function mergeTaskOriginConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TASK_ORIGIN_CONFIG, sources: DEFAULT_TASK_ORIGIN_CONFIG.sources.slice() };
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_TASK_ORIGIN_CONFIG.enabled,
    sources: Array.isArray(raw.sources) && raw.sources.length
      ? raw.sources.slice()
      : DEFAULT_TASK_ORIGIN_CONFIG.sources.slice(),
  };
}

function mergeTaintConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TAINT_CONFIG };
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_TAINT_CONFIG.enabled,
    mode: typeof raw.mode === 'string' && raw.mode ? raw.mode : DEFAULT_TAINT_CONFIG.mode,
    minValueLength: Number.isFinite(raw.minValueLength) && raw.minValueLength > 0
      ? Math.floor(raw.minValueLength)
      : DEFAULT_TAINT_CONFIG.minValueLength,
  };
}

function mergeProfileConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PROFILE_CONFIG };
  }
  return {
    default: typeof raw.default === 'string' && raw.default
      ? raw.default
      : DEFAULT_PROFILE_CONFIG.default,
  };
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_TASK_ORIGIN_CONFIG,
  DEFAULT_TAINT_CONFIG,
  DEFAULT_PROFILE_CONFIG,
  POLICY_ENFORCEMENT_LEVELS,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  DEFAULT_REQUEST_TIMEOUT_SECONDS,
  LOOPBACK_HOSTS,
  REQUEST_TIMEOUT_MS,
  PROTOCOL_VERSION,
  PACKAGE_VERSION,
  SKILLS_REGISTRY_URL,
  RELEASE_BASE_URL,
  FORWARDABLE_ACTIONS,
  SENSITIVE_TOOL_NAMES,
  COMPATIBILITY_MATRIX,
  WS_CLOSE_CODE_AUTH_REQUIRED,
  WS_CLOSE_CODE_FORBIDDEN_ORIGIN,
  isLoopbackHost,
  isOriginAllowed,
  matchesOriginPattern,
  resolveSecurityConfig,
};
