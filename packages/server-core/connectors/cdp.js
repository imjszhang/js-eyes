'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const {
  listOperationIdsForConnector,
  pageInteractCore,
} = require('@js-eyes/protocol');
const { JsonRpcSocket, waitForOpen } = require('./json-rpc-socket');
const { TabAliasMap } = require('./tab-alias');
const { assertLoopbackEndpoint, redactEndpoint } = require('./loopback');
const { registerBrowserClient, unregisterBrowserClient } = require('./registry');

function loadExtractPageContent() {
  try { return require('@js-eyes/page-extract').extractPageContent; } catch { /* optional */ }
  try { return require('../../page-extract').extractPageContent; } catch { /* optional */ }
  return function extractPageContentFallback(options) {
    const format = options && options.format ? options.format : 'text';
    /* eslint-disable no-undef -- serialized into the page via Function#toString */
    const content = document.body ? String(document.body.innerText || '') : '';
    return { content, format, status: 'ok', title: document.title || '', url: location.href || '' };
    /* eslint-enable no-undef */
  };
}

const {
  clickInPage,
  fillInPage,
  scrollInPage,
  waitForInPage,
  injectCssInPage,
  getOuterHtmlInPage,
  getPageInfoInPage,
} = pageInteractCore;

function channelUserDataDirs(channel) {
  const home = os.homedir();
  const name = channel || 'chrome';
  if (process.platform === 'darwin') {
    const map = {
      chrome: path.join(home, 'Library/Application Support/Google/Chrome'),
      'chrome-beta': path.join(home, 'Library/Application Support/Google/Chrome Beta'),
      'chrome-dev': path.join(home, 'Library/Application Support/Google/Chrome Dev'),
      'chrome-canary': path.join(home, 'Library/Application Support/Google/Chrome Canary'),
      msedge: path.join(home, 'Library/Application Support/Microsoft Edge'),
      chromium: path.join(home, 'Library/Application Support/Chromium'),
    };
    return [map[name] || map.chrome];
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const map = {
      chrome: path.join(local, 'Google', 'Chrome', 'User Data'),
      'chrome-beta': path.join(local, 'Google', 'Chrome Beta', 'User Data'),
      'chrome-dev': path.join(local, 'Google', 'Chrome Dev', 'User Data'),
      'chrome-canary': path.join(local, 'Google', 'Chrome SxS', 'User Data'),
      msedge: path.join(local, 'Microsoft', 'Edge', 'User Data'),
      chromium: path.join(local, 'Chromium', 'User Data'),
    };
    return [map[name] || map.chrome];
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const map = {
    chrome: path.join(configHome, 'google-chrome'),
    'chrome-beta': path.join(configHome, 'google-chrome-beta'),
    'chrome-dev': path.join(configHome, 'google-chrome-unstable'),
    chromium: path.join(configHome, 'chromium'),
    msedge: path.join(configHome, 'microsoft-edge'),
  };
  return [map[name] || map.chrome];
}

function readDevToolsActivePort(userDataDir) {
  const file = path.join(userDataDir, 'DevToolsActivePort');
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const port = Number(lines[0]);
  const wsPath = lines[1] || '/devtools/browser';
  if (!Number.isFinite(port) || port <= 0) return null;
  return { port, wsPath: wsPath.startsWith('/') ? wsPath : `/${wsPath}` };
}

function resolveChromeExecutable(channel) {
  const name = channel || 'chrome';
  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push(
      name === 'msedge' ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' : null,
      name === 'chromium' ? '/Applications/Chromium.app/Contents/MacOS/Chromium' : null,
      name === 'chrome-canary' ? '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary' : null,
      name === 'chrome-beta' ? '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta' : null,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );
  } else if (process.platform === 'win32') {
    const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
  } else {
    candidates.push('google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium', 'microsoft-edge');
  }
  for (const candidate of candidates.filter(Boolean)) {
    if (candidate.includes(path.sep) || candidate.includes('/')) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return candidates.find((item) => item && !item.includes(path.sep)) || 'google-chrome';
}

async function resolveCdpWebSocketUrl(endpoint) {
  const raw = String(endpoint || '').trim();
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) return raw;
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  try {
    const res = await fetch(`${url.origin}/json/version`);
    if (res.ok) {
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    }
  } catch { /* Chrome 144+ often has no HTTP discovery */ }
  return `ws://${url.hostname}:${url.port || 9222}/devtools/browser`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpConnector {
  constructor(options = {}) {
    this.config = options.config || {};
    this.security = options.security || {};
    this.state = options.state;
    this.audit = options.audit || null;
    this.logger = options.logger || console;
    this.clientId = options.clientId || null;
    this.rpc = null;
    this.aliases = new TabAliasMap();
    this.targets = new Map();
    this.sessions = new Map();
    this.child = null;
    this.userDataDir = null;
    this.stopped = false;
    this.reconnectDelay = 1000;
    this.wsUrl = null;
  }

  async start() {
    this.stopped = false;
    const mode = this.config.launch?.enabled ? 'launch' : (this.config.mode || 'attach');
    this.wsUrl = await this._resolveWsUrl(mode);
    await this._connect(this.wsUrl);
    this.reconnectDelay = 1000;
  }

  async stop() {
    this.stopped = true;
    if (this.clientId) unregisterBrowserClient(this.state, this.clientId);
    if (this.rpc) this.rpc.close();
    this.rpc = null;
    if (this.child && !this.child.killed) {
      try { this.child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    this.child = null;
  }

  isOpen() {
    return !!(this.rpc && this.rpc.connected);
  }

  async _resolveWsUrl(mode) {
    if (mode === 'launch') return this._launchChrome();
    if (mode === 'endpoint') {
      assertLoopbackEndpoint(this.config.endpoint, {
        loopbackOnly: this.config.loopbackOnly !== false,
        allowRemoteBind: Boolean(this.security.allowRemoteBind),
        label: 'cdp',
      });
      return resolveCdpWebSocketUrl(this.config.endpoint);
    }
    const dirs = channelUserDataDirs(this.config.channel);
    for (const dir of dirs) {
      const active = readDevToolsActivePort(dir);
      if (!active) continue;
      return `ws://127.0.0.1:${active.port}${active.wsPath}`;
    }
    throw new Error(
      'CDP attach failed: DevToolsActivePort not found. Enable chrome://inspect/#remote-debugging and click Allow.',
    );
  }

  async _launchChrome() {
    this.userDataDir = this.config.launch?.userDataDir
      || fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-cdp-'));
    const executable = resolveChromeExecutable(this.config.channel);
    const args = [
      `--user-data-dir=${this.userDataDir}`,
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
    ];
    if (this.config.launch?.headless !== false) args.push('--headless=new');
    this.child = spawn(executable, args, { stdio: 'ignore' });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const active = readDevToolsActivePort(this.userDataDir);
      if (active) return `ws://127.0.0.1:${active.port}${active.wsPath}`;
      await sleep(150);
    }
    throw new Error('CDP launch timed out waiting for DevToolsActivePort');
  }

  async _connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await waitForOpen(ws, 30000, 'Waiting for Chrome Allow dialog / CDP attach');
    this.rpc = new JsonRpcSocket(ws, {
      onEvent: (event) => this._onEvent(event),
    });
    ws.on('close', () => {
      if (this.clientId) unregisterBrowserClient(this.state, this.clientId);
      this.audit?.write?.('browser.connector.disconnect', {
        kind: 'cdp',
        clientId: this.clientId,
        endpoint: redactEndpoint(wsUrl),
      });
      this._scheduleReconnect();
    });
    await this.rpc.send('Target.setDiscoverTargets', { discover: true });
    try {
      await this.rpc.send('Target.setAutoAttach', {
        autoAttach: true,
        flatten: true,
        waitForDebuggerOnStart: false,
      });
    } catch { /* older Chrome */ }
    const { targetInfos = [] } = await this.rpc.send('Target.getTargets') || {};
    for (const info of targetInfos) this._rememberTarget(info);
    await this._refreshTabs();
    if (!this.clientId) {
      const crypto = require('crypto');
      this.clientId = crypto.randomUUID();
    }
    registerBrowserClient(this.state, this.clientId, {
      kind: 'cdp',
      transport: 'cdp',
      browserName: this.config.channel === 'msedge' ? 'edge' : 'chrome',
      capabilities: listOperationIdsForConnector('cdp'),
      tabs: this._tabList(),
      activeTabId: this._activeTabId(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isOpen: () => this.isOpen(),
      dispatch: (message) => this.dispatch(message),
      dispose: () => this.stop(),
    });
    this.audit?.write?.('browser.connector.connect', {
      kind: 'cdp',
      clientId: this.clientId,
      mode: this.config.mode || 'attach',
      endpoint: redactEndpoint(wsUrl),
    });
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    setTimeout(() => {
      if (this.stopped) return;
      this.start().catch((err) => {
        this.logger.warn?.(`[cdp] reconnect failed: ${err.message}`);
        this._scheduleReconnect();
      });
    }, delay);
  }

  _onEvent(event) {
    const method = event.method;
    const params = event.params || {};
    if (method === 'Target.targetCreated' && params.targetInfo) {
      this._rememberTarget(params.targetInfo);
      this._refreshTabs().catch(() => {});
    }
    if (method === 'Target.targetDestroyed' && params.targetId) {
      this.aliases.release(params.targetId);
      this.targets.delete(params.targetId);
      this.sessions.delete(params.targetId);
      this._refreshTabs().catch(() => {});
    }
    if (method === 'Target.targetInfoChanged' && params.targetInfo) {
      this._rememberTarget(params.targetInfo);
      this._refreshTabs().catch(() => {});
    }
  }

  _rememberTarget(info) {
    if (!info || !info.targetId) return;
    if (info.type && info.type !== 'page' && info.type !== 'tab') return;
    this.aliases.allocate(info.targetId);
    this.targets.set(info.targetId, info);
  }

  _tabList() {
    return [...this.targets.values()].map((info) => {
      const id = this.aliases.allocate(info.targetId);
      return {
        id,
        tabId: id,
        tabKey: info.targetId,
        url: info.url || '',
        title: info.title || '',
        active: Boolean(info.attached),
      };
    });
  }

  _activeTabId() {
    const tabs = this._tabList();
    const active = tabs.find((tab) => tab.active);
    return active ? active.id : (tabs[0] ? tabs[0].id : null);
  }

  async _refreshTabs() {
    const record = this.clientId && this.state.browserClients.get(this.clientId);
    if (record) {
      record.tabs = this._tabList();
      record.activeTabId = this._activeTabId();
      record.lastActivity = Date.now();
    }
  }

  async _sessionFor(targetId) {
    if (this.sessions.has(targetId)) return this.sessions.get(targetId);
    const attached = await this.rpc.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    const sessionId = attached && attached.sessionId;
    this.sessions.set(targetId, sessionId);
    try { await this.rpc.send('Runtime.runIfWaitingForDebugger', {}, sessionId ? { sessionId } : {}); } catch { /* ignore */ }
    return sessionId;
  }

  async _sendPage(targetId, method, params) {
    const sessionId = await this._sessionFor(targetId);
    return this.rpc.send(method, params, sessionId ? { sessionId } : {});
  }

  async _evaluate(targetId, fn, args, options = {}) {
    const expression = `Promise.resolve((${fn.toString()}).apply(null, ${JSON.stringify(args || [])}))`;
    const result = await this._sendPage(targetId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result && result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'Runtime.evaluate failed';
      const err = /** @type {Error & { code?: string }} */ (new Error(desc));
      err.code = options.errorCode || 'CONNECTOR_ERROR';
      throw err;
    }
    return result && result.result ? result.result.value : null;
  }

  _requireTarget(tabId) {
    const targetId = this.aliases.resolve(tabId);
    if (!targetId) {
      const err = /** @type {Error & { code?: string }} */ (new Error(`The requested browser tab was not found: ${tabId}`));
      err.code = 'TAB_NOT_FOUND';
      throw err;
    }
    return targetId;
  }

  async dispatch(message) {
    const { type, requestId } = message;
    const complete = (payload) => {
      require('../ws-handler')._internal.resolveRequest(
        requestId,
        { status: 'success', requestId, ...payload },
        this.state,
      );
    };
    try {
      switch (type) {
        case 'open_url': {
          let targetId = message.tabId != null ? this.aliases.resolve(message.tabId) : null;
          if (!targetId) {
            const created = await this.rpc.send('Target.createTarget', { url: message.url });
            targetId = created.targetId;
            this.aliases.allocate(targetId);
            this.targets.set(targetId, { targetId, type: 'page', url: message.url, title: '' });
          } else {
            await this._sendPage(targetId, 'Page.navigate', { url: message.url });
          }
          const tabId = this.aliases.allocate(targetId);
          await this._refreshTabs();
          complete({ type: 'open_url_complete', tabId, url: message.url, cookies: [] });
          break;
        }
        case 'close_tab': {
          const targetId = this._requireTarget(message.tabId);
          await this.rpc.send('Target.closeTarget', { targetId });
          complete({ type: 'close_tab_complete', tabId: message.tabId });
          break;
        }
        case 'get_html': {
          const targetId = this._requireTarget(message.tabId);
          const html = await this._evaluate(targetId, getOuterHtmlInPage, []);
          complete({ type: 'tab_html_complete', tabId: message.tabId, html: html || '' });
          break;
        }
        case 'execute_script': {
          if (!this.security.allowRawEval) {
            const err = /** @type {Error & { code?: string }} */ (new Error('Raw JavaScript execution is disabled'));
            err.code = 'RAW_EVAL_DISABLED';
            throw err;
          }
          const targetId = this._requireTarget(message.tabId);
          const result = await this._evaluate(targetId, function run(code) {
            return (0, eval)(code);
          }, [message.code]);
          complete({ type: 'execute_script_complete', tabId: message.tabId, result });
          break;
        }
        case 'inject_css': {
          const targetId = this._requireTarget(message.tabId);
          await this._evaluate(targetId, injectCssInPage, [message.css]);
          complete({ type: 'inject_css_complete', tabId: message.tabId });
          break;
        }
        case 'get_cookies': {
          const targetId = this._requireTarget(message.tabId);
          const info = this.targets.get(targetId) || {};
          const cookies = await this._getCookies(info.url || undefined);
          complete({ type: 'get_cookies_complete', tabId: message.tabId, url: info.url || '', cookies });
          break;
        }
        case 'get_cookies_by_domain': {
          const cookies = (await this._getCookies()).filter((cookie) => {
            const host = String(cookie.domain || '').replace(/^\./, '');
            const domain = String(message.domain || '');
            if (!domain) return false;
            if (message.includeSubdomains === false) return host === domain;
            return host === domain || host.endsWith(`.${domain}`);
          });
          complete({
            type: 'get_cookies_by_domain_complete',
            domain: message.domain,
            cookies,
            total: cookies.length,
          });
          break;
        }
        case 'get_page_info': {
          const targetId = this._requireTarget(message.tabId);
          const data = await this._evaluate(targetId, getPageInfoInPage, []);
          complete({ type: 'get_page_info_complete', tabId: message.tabId, data: data || {} });
          break;
        }
        case 'click': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._evaluate(targetId, clickInPage, [
            message.selector || '*',
            message.text || '',
            message.index || 0,
          ]);
          complete({ type: 'click_complete', tabId: message.tabId, result });
          break;
        }
        case 'fill': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._evaluate(targetId, fillInPage, [
            message.selector,
            message.value || '',
            !!message.clearFirst,
            message.index || 0,
          ]);
          complete({ type: 'fill_complete', tabId: message.tabId, result });
          break;
        }
        case 'scroll': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._evaluate(targetId, scrollInPage, [
            message.target || 'bottom',
            message.selector || '',
            message.pixels || 0,
          ]);
          complete({ type: 'scroll_complete', tabId: message.tabId, result });
          break;
        }
        case 'wait_for': {
          const targetId = this._requireTarget(message.tabId);
          const timeoutSec = Number.isFinite(message.timeout) ? message.timeout : 10;
          const result = await this._evaluate(targetId, waitForInPage, [
            message.selector,
            timeoutSec * 1000,
            !!message.visible,
          ]);
          complete({ type: 'wait_for_complete', tabId: message.tabId, result });
          break;
        }
        case 'extract_page': {
          const targetId = this._requireTarget(message.tabId);
          const extractPageContent = loadExtractPageContent();
          const result = await this._evaluate(targetId, extractPageContent, [message]);
          complete({ type: 'extract_page_complete', tabId: message.tabId, result });
          break;
        }
        case 'upload_file_to_tab': {
          const targetId = this._requireTarget(message.tabId);
          const files = await this._materializeUploads(message.files || []);
          const selector = message.targetSelector || 'input[type="file"]';
          const sessionId = await this._sessionFor(targetId);
          const { root } = await this.rpc.send('DOM.getDocument', { depth: 0 }, sessionId ? { sessionId } : {});
          const { nodeId } = await this.rpc.send('DOM.querySelector', {
            nodeId: root.nodeId,
            selector,
          }, sessionId ? { sessionId } : {});
          await this.rpc.send('DOM.setFileInputFiles', {
            nodeId,
            files: files.map((file) => file.path),
          }, sessionId ? { sessionId } : {});
          complete({
            type: 'upload_file_to_tab_complete',
            tabId: message.tabId,
            uploadedFiles: files.map((file) => file.name),
          });
          break;
        }
        case 'capture_screenshot': {
          const targetId = this._requireTarget(message.tabId);
          const format = message.format === 'jpeg' ? 'jpeg' : 'png';
          const params = { format, fromSurface: true };
          if (format === 'jpeg' && message.quality != null) params.quality = message.quality;
          if (message.fullPage) params.captureBeyondViewport = true;
          const shot = await this._sendPage(targetId, 'Page.captureScreenshot', params);
          complete({
            type: 'capture_screenshot_complete',
            tabId: message.tabId,
            format,
            dataUrl: shot && shot.data ? `data:image/${format};base64,${shot.data}` : null,
            fullPage: !!message.fullPage,
          });
          break;
        }
        default:
          throw new Error(`Unknown action: ${type}`);
      }
    } catch (error) {
      require('../ws-handler')._internal.resolveRequest(requestId, {
        status: 'error',
        type: 'error',
        message: error.message,
        code: error.code || 'CONNECTOR_ERROR',
        requestId,
      }, this.state);
    }
  }

  async _getCookies(url) {
    try {
      if (url) {
        const result = await this.rpc.send('Network.getCookies', { urls: [url] });
        return result.cookies || [];
      }
      const result = await this.rpc.send('Network.getAllCookies');
      return result.cookies || [];
    } catch {
      return [];
    }
  }

  async _materializeUploads(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-upload-'));
    return files.map((file, index) => {
      const name = path.basename(file.name || `upload-${index}`);
      const dest = path.join(dir, name);
      fs.writeFileSync(dest, Buffer.from(file.base64 || '', 'base64'));
      return { name, path: dest };
    });
  }
}

function createCdpConnector(options) {
  return new CdpConnector(options);
}

module.exports = {
  CdpConnector,
  createCdpConnector,
  channelUserDataDirs,
  readDevToolsActivePort,
  resolveCdpWebSocketUrl,
  resolveChromeExecutable,
};
