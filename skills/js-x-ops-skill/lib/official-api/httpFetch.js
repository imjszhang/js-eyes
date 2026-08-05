'use strict';

const { fetch: undiciFetch, ProxyAgent, Socks5ProxyAgent } = require('undici');

const PROXY_ENV_KEYS = [
  ['JS_X_OPS_PROXY', 'JS_X_OPS_PROXY'],
  ['HTTPS_PROXY', 'HTTPS_PROXY'],
  ['https_proxy', 'https_proxy'],
  ['HTTP_PROXY', 'HTTP_PROXY'],
  ['http_proxy', 'http_proxy'],
  ['ALL_PROXY', 'ALL_PROXY'],
  ['all_proxy', 'all_proxy'],
];

const DIRECT_VALUES = new Set(['off', 'none', 'direct', 'false', '0']);

let cachedProxyUrl = null;
let cachedDispatcher = null;

function unquoteEnvValue(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function resolveProxyUrl(env = process.env) {
  for (const [key, source] of PROXY_ENV_KEYS) {
    const raw = env[key];
    if (raw === undefined || raw === null) continue;
    const trimmed = unquoteEnvValue(raw);
    if (!trimmed) continue;
    if (DIRECT_VALUES.has(trimmed.toLowerCase())) {
      if (key === 'JS_X_OPS_PROXY') return null;
      continue;
    }
    return { url: trimmed, source };
  }
  return null;
}

/**
 * @returns {'http'|'socks5'}
 */
function classifyProxyProtocol(proxyUrl) {
  const lower = String(proxyUrl || '').trim().toLowerCase();
  if (lower.startsWith('socks4://') || lower.startsWith('socks4a://')) {
    throw new Error(
      'SOCKS4 is not supported for Official API. Use socks5:// (e.g. socks5://127.0.0.1:1080) or http://.',
    );
  }
  if (
    lower.startsWith('socks5://')
    || lower.startsWith('socks5h://')
    || lower.startsWith('socks://')
  ) {
    return 'socks5';
  }
  if (/^https?:\/\//i.test(lower)) {
    return 'http';
  }
  throw new Error(
    `Unsupported proxy URL for Official API: ${proxyUrl}. Use http://, https://, or socks5://.`,
  );
}

function normalizeSocks5ProxyUrl(proxyUrl) {
  return String(proxyUrl)
    .trim()
    .replace(/^socks5h:\/\//i, 'socks5://')
    .replace(/^socks:\/\//i, 'socks5://');
}

function sanitizeProxyHost(proxyUrl) {
  try {
    const parsed = new URL(proxyUrl);
    if (parsed.username || parsed.password) {
      return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    }
    return parsed.host;
  } catch (_) {
    return 'invalid';
  }
}

function getProxyInfo(env = process.env) {
  const resolved = resolveProxyUrl(env);
  if (!resolved) {
    return { enabled: false, source: null, host: null, protocol: null };
  }
  let protocol = null;
  try {
    protocol = classifyProxyProtocol(resolved.url);
  } catch (_) {
    protocol = 'invalid';
  }
  return {
    enabled: true,
    source: resolved.source,
    host: sanitizeProxyHost(resolved.url),
    protocol,
  };
}

function createProxyDispatcher(proxyUrl) {
  const protocol = classifyProxyProtocol(proxyUrl);
  if (protocol === 'socks5') {
    if (typeof Socks5ProxyAgent !== 'function') {
      throw new Error(
        'SOCKS5 proxy requires undici Socks5ProxyAgent. Upgrade Node/undici, or use an HTTP(S) proxy URL.',
      );
    }
    return new Socks5ProxyAgent(normalizeSocks5ProxyUrl(proxyUrl));
  }
  return new ProxyAgent(proxyUrl);
}

function getProxyDispatcher(env = process.env) {
  const resolved = resolveProxyUrl(env);
  if (!resolved) {
    cachedProxyUrl = null;
    cachedDispatcher = null;
    return null;
  }

  if (cachedDispatcher && cachedProxyUrl === resolved.url) {
    return cachedDispatcher;
  }

  cachedProxyUrl = resolved.url;
  cachedDispatcher = createProxyDispatcher(resolved.url);
  return cachedDispatcher;
}

function resetProxyCacheForTests() {
  cachedProxyUrl = null;
  cachedDispatcher = null;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = getProxyDispatcher();
  const fetchFn = dispatcher ? undiciFetch : (globalThis.fetch || undiciFetch);

  try {
    return await fetchFn(url, {
      ...opts,
      headers: { Connection: 'close', ...(opts.headers || {}) },
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  resolveProxyUrl,
  getProxyInfo,
  getProxyDispatcher,
  fetchWithTimeout,
  resetProxyCacheForTests,
  sanitizeProxyHost,
  classifyProxyProtocol,
  normalizeSocks5ProxyUrl,
};
