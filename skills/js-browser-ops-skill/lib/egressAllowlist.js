'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const { loadConfig, saveConfig } = require('@js-eyes/config');

function normalizeHost(input) {
  if (!input || typeof input !== 'string') return null;
  try {
    return new URL(input).hostname.toLowerCase();
  } catch (_) {
    const host = input.trim().toLowerCase();
    if (!host || host.includes('/') || host.includes(':')) return null;
    return host;
  }
}

function hostMatches(host, pattern) {
  const h = normalizeHost(host);
  const p = normalizeHost(pattern);
  if (!h || !p) return false;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1);
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return h === p;
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

async function ensureDomainAllowedForUrl(url, options = {}) {
  const host = normalizeHost(url);
  if (!host) return { host: null, changed: false, ready: true };

  const config = loadConfig();
  const security = config.security && typeof config.security === 'object'
    ? config.security
    : {};
  const current = Array.isArray(security.egressAllowlist)
    ? security.egressAllowlist.slice()
    : [];

  if (current.some((entry) => hostMatches(host, entry))) {
    return { host, changed: false, ready: true };
  }

  const next = {
    ...config,
    security: {
      ...security,
      egressAllowlist: [...current, host],
    },
  };
  saveConfig(next);

  const ready = await waitForServerAllowlist(options.serverUrl, host, {
    timeoutMs: options.timeoutMs,
    intervalMs: options.intervalMs,
  });
  return { host, changed: true, ready };
}

module.exports = {
  ensureDomainAllowedForUrl,
  fetchServerAllowlist,
  hostMatches,
  normalizeHost,
  waitForServerAllowlist,
};
