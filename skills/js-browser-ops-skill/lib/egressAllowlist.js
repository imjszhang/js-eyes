'use strict';

const dns = require('node:dns').promises;
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const net = require('node:net');

const { loadConfig, saveConfig } = require('@js-eyes/config');

class PolicyDeniedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PolicyDeniedError';
    this.code = 'policy_denied';
    this.retryable = false;
    this.details = details;
  }
}

function normalizeHost(input) {
  if (!input || typeof input !== 'string') return null;
  try {
    const host = new URL(input.includes('://') ? input : `https://${input}`).hostname
      .toLowerCase()
      .replace(/\.$/, '');
    return host || null;
  } catch (_) {
    const host = input.trim().toLowerCase().replace(/\.$/, '');
    if (!host || host.includes('/') || host.includes(':') && !net.isIP(host)) return null;
    return host;
  }
}

function hostMatches(host, pattern) {
  const h = normalizeHost(host);
  const p = normalizeHost(pattern);
  if (!h || !p) return false;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1);
    return h.endsWith(suffix) && h.length > suffix.length && !h.slice(0, -suffix.length).includes('.');
  }
  return h === p;
}

function parseIPv4(host) {
  if (typeof host !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split('.').map((part) => {
    if (part.length > 1 && part.startsWith('0')) return null;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
  });
  if (parts.some((part) => part == null)) return null;
  return parts;
}

function isPrivateIPv4(parts) {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIPv6(host) {
  const value = String(host || '').toLowerCase();
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  if (value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) {
    const parts = parseIPv4(mapped[1]);
    return Boolean(parts && isPrivateIPv4(parts));
  }
  return false;
}

function isPrivateLiteral(host) {
  const normalized = normalizeHost(host);
  if (!normalized) return true;
  if (normalized === 'localhost') return true;
  const ipv4 = parseIPv4(normalized);
  if (ipv4) return isPrivateIPv4(ipv4);
  if (net.isIP(normalized) === 6) return isPrivateIPv6(normalized);
  if (/^\d+$/.test(normalized)) return true;
  return false;
}

async function resolveAddresses(host, lookup = dns.lookup) {
  const normalized = normalizeHost(host);
  if (!normalized) return [];
  if (net.isIP(normalized)) return [normalized];
  if (normalized === 'localhost') return ['127.0.0.1', '::1'];
  try {
    const records = await lookup(normalized, { all: true, verbatim: true });
    return (Array.isArray(records) ? records : [records])
      .map((record) => record?.address || record)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function deny(reason, details = {}) {
  throw new PolicyDeniedError(
    `Egress policy denied this host. Add it to security.egressAllowlist, or pass an explicit session/persist grant. Reason: ${reason}.`,
    { reason, ...details },
  );
}

function envEnabled(name) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function isSessionGrant(options = {}) {
  if (options.autoAllowDomain === true) return true;
  if (options.autoAllowDomain === false) return false;
  return envEnabled('JS_EYES_AUTO_ALLOW_DOMAIN');
}

function resolveHttpStatusUrl(serverUrl) {
  const raw = serverUrl || 'ws://localhost:18080';
  const parsed = new URL(raw.startsWith('ws')
    ? raw.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
    : raw);
  parsed.pathname = '/api/browser/status';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function readServerToken() {
  if (process.env.JS_EYES_SERVER_TOKEN) return process.env.JS_EYES_SERVER_TOKEN;
  if (process.env.JS_EYES_TOKEN) return process.env.JS_EYES_TOKEN;
  const baseDir = process.env.JS_EYES_HOME
    ? path.resolve(process.env.JS_EYES_HOME)
    : path.join(os.homedir(), '.js-eyes');
  const candidates = [
    path.join(baseDir, 'runtime', 'server.token'),
    path.join(baseDir, 'secrets', 'server-token'),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const token = fs.readFileSync(file, 'utf8').trim();
        if (token) return token;
      }
    } catch (_) {}
  }
  return null;
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(parsed, {
      method: 'GET',
      timeout: options.timeoutMs || 3000,
      headers: options.headers || {},
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : null;
          resolve({ statusCode: res.statusCode, json, body });
        } catch (err) {
          reject(new Error(`无法解析服务端响应: ${err.message}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('查询 js-eyes server 状态超时'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchServerAllowlist(serverUrl) {
  const token = readServerToken();
  const headers = { Origin: 'http://localhost' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await requestJson(resolveHttpStatusUrl(serverUrl), { headers, timeoutMs: 3000 });
  if (response.statusCode !== 200) {
    throw new Error(`查询 js-eyes server 状态失败: HTTP ${response.statusCode}`);
  }
  const list = response.json?.data?.policy?.egressAllowlist;
  return Array.isArray(list) ? list : [];
}

async function waitForServerAllowlist(serverUrl, host, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const intervalMs = options.intervalMs || 250;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const list = await fetchServerAllowlist(serverUrl);
      if (list.some((entry) => hostMatches(host, entry))) return true;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  void lastError;
  return false;
}

function currentAllowlist(config) {
  const security = config.security && typeof config.security === 'object' ? config.security : {};
  return Array.isArray(security.egressAllowlist) ? security.egressAllowlist.slice() : [];
}

function appendAudit(entry, options = {}) {
  const baseDir = process.env.JS_EYES_HOME
    ? path.resolve(process.env.JS_EYES_HOME)
    : path.join(os.homedir(), '.js-eyes');
  const file = options.auditPath || path.join(baseDir, 'logs', 'egress-allowlist-audit.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({
    at: new Date().toISOString(),
    host: entry.host,
    actor: entry.actor || 'js-browser-ops-skill',
    runId: entry.runId || null,
    persist: true,
  })}\n`);
  return file;
}

async function authorizeUrlForRead(url, options = {}) {
  const host = normalizeHost(url);
  if (!host) deny('unparseable_host');

  const load = options.loadConfig || loadConfig;
  const save = options.saveConfig || saveConfig;
  const lookup = options.lookup || dns.lookup;
  const config = load();
  const allowlist = currentAllowlist(config);
  const listed = allowlist.some((entry) => hostMatches(host, entry));
  const allowPrivate = options.allowPrivateNetwork === true;
  const persist = options.persistAllowDomain === true;
  const sessionGrant = isSessionGrant(options);

  if (isPrivateLiteral(host) && !allowPrivate) {
    deny('private_network', { host });
  }

  const addresses = await resolveAddresses(host, lookup);
  if (addresses.some((address) => isPrivateLiteral(address)) && !allowPrivate) {
    deny('private_network_resolution', { host, addresses });
  }

  if (listed && (allowPrivate || !isPrivateLiteral(host))) {
    return { host, changed: false, ready: true, mode: 'allowlist' };
  }

  if (sessionGrant && !persist) {
    options.policy?.egress?.allowSession?.(url);
    return { host, changed: false, ready: true, mode: 'session' };
  }

  if (!persist) {
    deny('not_allowlisted', { host });
  }

  const next = {
    ...config,
    security: {
      ...(config.security && typeof config.security === 'object' ? config.security : {}),
      egressAllowlist: [...allowlist, host],
    },
  };
  save(next);
  appendAudit({
    host,
    actor: options.actor,
    runId: options.runId,
  }, options);
  const ready = await waitForServerAllowlist(options.serverUrl, host, {
    timeoutMs: options.timeoutMs,
    intervalMs: options.intervalMs,
  });
  if (!ready) deny('allowlist_not_hot_reloaded', { host });
  return { host, changed: true, ready: true, mode: 'persist' };
}

async function ensureDomainAllowedForUrl(url, options = {}) {
  return authorizeUrlForRead(url, options);
}

module.exports = {
  PolicyDeniedError,
  authorizeUrlForRead,
  ensureDomainAllowedForUrl,
  fetchServerAllowlist,
  hostMatches,
  isPrivateLiteral,
  isSessionGrant,
  normalizeHost,
  resolveAddresses,
  waitForServerAllowlist,
};
