'use strict';

const fs = require('fs');
const path = require('path');
const { BrowserAutomation } = require('./js-eyes-client');
const { getPageProfile, DEFAULT_WS_ENDPOINT, isXhsHostname } = require('./config');

const BRIDGES_DIR = path.join(__dirname, '..', 'bridges');

/**
 * makeBridgeExpander - 简化版 bridge 内联展开器（不依赖 visual-bridge-kit）。
 * 只识别 `// @@include ./relative.js` 形式（相对 BRIDGES_DIR）。
 */
function makeBridgeExpander({ baseDir }) {
  const visited = new Set();
  return function expand(source, fromFile) {
    return source.replace(/^[\t ]*\/\/\s*@@include\s+([^\r\n]+?)\s*$/gm, (_match, rawPath) => {
      const cleaned = String(rawPath).trim();
      let abs;
      if (cleaned.startsWith('./') || cleaned.startsWith('../')) {
        const baseFrom = fromFile ? path.dirname(fromFile) : baseDir;
        abs = path.resolve(baseFrom, cleaned);
      } else if (path.isAbsolute(cleaned)) {
        abs = cleaned;
      } else {
        // 不再支持外部包注入；遇到时跳过（保持 bridge 仍可加载）
        return `// @@include ${cleaned} (skipped: only relative paths supported)`;
      }
      if (visited.has(abs)) {
        return `// @@include ${cleaned} (already inlined)`;
      }
      visited.add(abs);
      let content;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch (err) {
        return `// @@include ${cleaned} (read failed: ${err.message})`;
      }
      const expanded = expand(content, abs);
      return `/* >>> @@include ${cleaned} */\n${expanded}\n/* <<< @@include ${cleaned} */`;
    });
  };
}

const expandBridgeSource = makeBridgeExpander({ baseDir: BRIDGES_DIR });

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!/^[\[{"]/.test(trimmed) && !/^(true|false|null|-?\d)/.test(trimmed)) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

function pickTabMatchingProfile(tabs, profile, options = {}) {
  if (!Array.isArray(tabs) || !tabs.length) return null;
  const targetUrl = options.targetUrl || null;
  if (targetUrl) {
    const exact = tabs.find((t) => (t && t.url) === targetUrl);
    if (exact) return exact;
  }
  const scored = tabs
    .map((t) => ({ tab: t, score: typeof profile.score === 'function' ? profile.score(t) : 0 }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].tab : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function urlsEquivalent(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  let ua, ub;
  try { ua = new URL(a); } catch (_) { return a === b; }
  try { ub = new URL(b); } catch (_) { return a === b; }
  if (ua.protocol !== ub.protocol) return false;
  if (ua.hostname.toLowerCase() !== ub.hostname.toLowerCase()) return false;
  if ((ua.port || '') !== (ub.port || '')) return false;
  const pa = ua.pathname.replace(/\/+$/, '') || '/';
  const pb = ub.pathname.replace(/\/+$/, '') || '/';
  if (pa !== pb) return false;
  const sa = [...ua.searchParams.entries()].sort();
  const sb = [...ub.searchParams.entries()].sort();
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i][0] !== sb[i][0] || sa[i][1] !== sb[i][1]) return false;
  }
  return true;
}

function isXhsTabUrl(url) {
  try {
    const u = new URL(url || '');
    return isXhsHostname(u.hostname);
  } catch (_) {
    return false;
  }
}

class Session {
  constructor({ opts = {} } = {}) {
    this.opts = opts;
    this.pageProfile = getPageProfile(opts.page);
    this.bot = opts.bot || null;
    this._ownsBot = !opts.bot;
    this.target = null;
    this._bridgeSrcCache = null;
    this._bridgeVersionCache = null;
  }

  log(msg) {
    if (this.opts.verbose) process.stderr.write(`[xhs-session] ${msg}\n`);
  }

  async connect() {
    if (this.bot) return;
    const wsEndpoint = this.opts.wsEndpoint || DEFAULT_WS_ENDPOINT;
    const logger = this.opts.verbose
      ? console
      : { info: () => {}, warn: (...a) => console.error(...a), error: (...a) => console.error(...a) };
    this.bot = new BrowserAutomation(wsEndpoint, { logger });
    try {
      await this.bot.connect();
    } catch (err) {
      const wrapped = new Error(
        `无法连接到 js-eyes server（${wsEndpoint}）。确认 server 已启动（js-eyes server status）。原始错误: ${err.message}`,
      );
      wrapped.code = 'E_SERVER_CONNECT';
      throw wrapped;
    }
    this.log(`connected to ${wsEndpoint}`);
  }

  async listTabs() {
    const data = await this.bot.getTabs();
    if (Array.isArray(data)) return data;
    return (data && data.tabs) || [];
  }

  async resolveTarget() {
    const explicit = this.opts.tab;
    if (explicit != null) {
      const rawId = parseInt(explicit, 10);
      if (!Number.isFinite(rawId)) {
        const err = new Error(`--tab 值非法: ${explicit}`);
        err.code = 'E_BAD_ARG';
        throw err;
      }
      this.target = { id: String(rawId), rawId, url: '(explicit)' };
      if (this.opts.targetUrl) await this._navigateAndVerify(this.opts.targetUrl);
      this.log(`target: ${this.target.id} (explicit)`);
      return this.target;
    }

    const tabs = await this.listTabs();
    const targetUrl = this.opts.targetUrl || null;
    const navigateOnReuse = this.opts.navigateOnReuse !== false;
    const reuseAnyXhsTab = this.opts.reuseAnyXhsTab === true;
    const createUrl = this.opts.createUrl || targetUrl || null;

    let hit = pickTabMatchingProfile(tabs, this.pageProfile, { targetUrl });
    if (!hit && reuseAnyXhsTab) {
      hit = tabs.find((t) => isXhsTabUrl(t && t.url)) || null;
    }

    if (hit) {
      this.target = { id: String(hit.id), rawId: parseInt(hit.id, 10), url: hit.url || '' };
      if (navigateOnReuse && targetUrl && !urlsEquivalent(this.target.url, targetUrl)) {
        await this._navigateAndVerify(targetUrl);
      }
      this.log(`target: ${this.target.id} (${this.target.url})`);
      return this.target;
    }

    if (this.opts.createIfMissing !== false && createUrl) {
      this.log(`opening new tab: ${createUrl}`);
      const newTabId = await this.bot.openUrl(createUrl);
      this.target = {
        id: String(newTabId),
        rawId: parseInt(newTabId, 10),
        url: createUrl,
        _created: true,
      };
      await this._waitForReady(20000);
      try {
        const actual = await this.callRaw('location.href');
        if (typeof actual === 'string' && actual) this.target.url = actual;
      } catch (_) {}
      this.log(`target: ${this.target.id} (newly opened: ${this.target.url})`);
      return this.target;
    }

    const listing = tabs.map((tab) => `  [${tab.id}] ${tab.url || ''}`).join('\n');
    const err = new Error(
      `未找到 tab 命中 profile=${this.pageProfile.name}（fragment=${this.pageProfile.targetUrlFragment}）。当前 tabs:\n${listing || '  (empty)'}`,
    );
    err.code = 'E_NO_TAB';
    throw err;
  }

  async _navigateAndVerify(targetUrl) {
    if (!this.target || !Number.isFinite(this.target.rawId)) {
      const err = new Error('_navigateAndVerify 前必须先选定 target');
      err.code = 'E_NO_TAB';
      throw err;
    }
    const fromUrl = this.target.url;
    this.log(`navigate ${this.target.id}: ${fromUrl} -> ${targetUrl}`);
    try {
      await this.bot.openUrl(targetUrl, this.target.rawId);
    } catch (err) {
      const wrapped = new Error(
        `navigate 失败 tab=${this.target.id} -> ${targetUrl}: ${(err && err.message) || err}`,
      );
      wrapped.code = 'E_NAV_FAILED';
      wrapped.detail = { tabId: this.target.id, fromUrl, targetUrl, original: (err && err.message) || String(err) };
      throw wrapped;
    }

    const urlSwitchTimeoutMs = 12000;
    const urlSwitchStart = Date.now();
    let actual = null;
    while (Date.now() - urlSwitchStart < urlSwitchTimeoutMs) {
      try { actual = await this.callRaw('location.href'); }
      catch (_) { actual = null; }
      if (typeof actual === 'string' && actual && urlsEquivalent(actual, targetUrl)) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    if (typeof actual !== 'string' || !actual) {
      const wrapped = new Error(`navigate verify 失败：无法读取 location.href（tab=${this.target.id}）`);
      wrapped.code = 'E_NAV_VERIFY_FAILED';
      wrapped.detail = { tabId: this.target.id, fromUrl, targetUrl, actual };
      throw wrapped;
    }

    if (!urlsEquivalent(actual, targetUrl)) {
      const wrapped = new Error(
        `navigate verify 失败：tab=${this.target.id} 实际 URL=${actual} 与期望 ${targetUrl} 不匹配（${urlSwitchTimeoutMs}ms 内未切换）`,
      );
      wrapped.code = 'E_NAV_VERIFY_FAILED';
      wrapped.detail = { tabId: this.target.id, fromUrl, targetUrl, actual };
      throw wrapped;
    }

    await this._waitForReady(15000);
    this.target.url = actual;
    this.log(`navigate verified: ${this.target.id} @ ${actual}`);
  }

  async _waitForReady(timeoutMs) {
    if (!this.target) return;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const state = await this.bot.executeScript(
          this.target.rawId,
          `(() => ({ readyState: document.readyState, url: location.href }))()`,
          { timeout: 5 },
        );
        if (state && (state.readyState === 'complete' || state.readyState === 'interactive')) {
          if (state.url) this.target.url = state.url;
          return;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  _readBridgeSrc() {
    if (this._bridgeSrcCache != null) {
      return { src: this._bridgeSrcCache, version: this._bridgeVersionCache };
    }
    const raw = fs.readFileSync(this.pageProfile.bridgePath, 'utf8');
    const m = raw.match(/const\s+VERSION\s*=\s*['"]([\w.\-+]+)['"]/);
    if (!m) {
      const err = new Error(`${this.pageProfile.bridgePath} 缺少 VERSION 常量`);
      err.code = 'E_BRIDGE_CORRUPT';
      throw err;
    }
    this._bridgeVersionCache = m[1];
    this._bridgeSrcCache = expandBridgeSource(raw, this.pageProfile.bridgePath);
    return { src: this._bridgeSrcCache, version: this._bridgeVersionCache };
  }

  async callRaw(expression, options = {}) {
    if (!this.target) {
      const err = new Error('callRaw 前必须先 resolveTarget');
      err.code = 'E_NO_TAB';
      throw err;
    }
    const timeoutSec = Math.max(1, Math.ceil((options.timeoutMs || 90000) / 1000));
    const result = await this.bot.executeScript(this.target.rawId, expression, { timeout: timeoutSec });
    return parseMaybeJson(result);
  }

  async ensureBridge() {
    const { src, version } = this._readBridgeSrc();
    let cur = null;
    try {
      cur = await this.callRaw(
        `(window.${this.pageProfile.bridgeGlobal} && window.${this.pageProfile.bridgeGlobal}.__meta && window.${this.pageProfile.bridgeGlobal}.__meta.version) || null`,
      );
    } catch (_) {
      cur = null;
    }
    if (cur === version) {
      this.log(`bridge up-to-date (${version})`);
      return { version, reinstalled: false };
    }
    this.log(`bridge ${cur ? `stale ${cur}` : 'missing'}, installing ${version}...`);
    const installResult = await this.callRaw(src, { timeoutMs: 30000 });
    if (!installResult || installResult.ok !== true) {
      const err = new Error(`bridge 注入失败: ${JSON.stringify(installResult)}`);
      err.code = 'E_BRIDGE_INSTALL';
      err.detail = installResult;
      throw err;
    }
    this.log(`bridge installed: version=${installResult.version}`);
    return { version, reinstalled: true };
  }

  async callApi(method, args = [], options = {}) {
    const payload = JSON.stringify(args || []);
    const global = this.pageProfile.bridgeGlobal;
    const code = `Promise.resolve(
      (typeof window.${global} === 'undefined')
        ? { ok: false, error: 'bridge_not_installed' }
        : (typeof window.${global}.${method} !== 'function')
          ? { ok: false, error: 'method_not_found', method: ${JSON.stringify(method)} }
          : window.${global}.${method}(...${payload})
    ).then(r => JSON.stringify(r)).catch(e => JSON.stringify({ ok:false, error: String((e && e.message) || e), stack: (e && e.stack) || null }))`;
    const result = await this.callRaw(code, options);
    if (!isPlainObject(result)) {
      return { ok: false, error: 'bridge_returned_non_object', raw: result };
    }
    return result;
  }

  async awaitBridgeAfterNav(opts = {}) {
    const {
      timeoutMs = 20000,
      intervalMs = 500,
      initialDelayMs = 400,
      fromUrl = null,
      expectedUrl = null,
    } = opts;
    const deadline = Date.now() + timeoutMs;
    let attempts = 0;
    let lastErr = null;
    let curHref = null;
    if (initialDelayMs > 0) await new Promise((r) => setTimeout(r, initialDelayMs));
    while (Date.now() < deadline) {
      attempts++;
      try { curHref = await this.callRaw('location.href'); }
      catch (err) { lastErr = (err && err.message) || String(err); curHref = null; }
      const urlChanged = !fromUrl || (curHref && curHref !== fromUrl);
      const urlMatches = !expectedUrl || (curHref && curHref === expectedUrl);
      if (urlChanged && urlMatches && curHref) {
        try {
          await this.ensureBridge();
          const stateResp = await this.callApi('state');
          if (stateResp && stateResp.ok && stateResp.data && stateResp.data.ready) {
            return { ready: true, attempts, currentUrl: curHref, state: stateResp.data };
          }
          lastErr = 'state_not_ready';
        } catch (err) {
          lastErr = (err && err.message) || String(err);
        }
      } else if (!urlChanged) {
        lastErr = 'url_unchanged';
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return { ready: false, attempts, currentUrl: curHref, state: null, error: lastErr || 'timeout' };
  }

  async close() {
    if (this._ownsBot) {
      try { if (this.bot) this.bot.disconnect(); } catch (_) {}
    }
    this.bot = null;
    this.target = null;
  }
}

module.exports = { Session, pickTabMatchingProfile, expandBridgeSource, urlsEquivalent };
