'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const {
  listOperationIdsForConnector,
  pageInteractCore,
} = require('@js-eyes/client-sdk/protocol');
const { JsonRpcSocket, waitForOpen } = require('./json-rpc-socket');
const { TabAliasMap } = require('./tab-alias');
const { assertLoopbackEndpoint, redactEndpoint } = require('./loopback');
const {
  classifyCookies,
  cookieIdentity,
  cookieMatchesDomain,
  publicCookieWriteResult,
  toCdpSetCookie,
  toCanonicalCookie,
} = require('./cookie-record');
const { registerBrowserClient, unregisterBrowserClient } = require('./registry');
const { publicDownload, publicDownloadList } = require('./download-record');
const { getPaths } = require('@js-eyes/client-sdk/runtime-paths');

function loadExtractPageContent() {
  try { return require('@js-eyes/page-extract').extractPageContent; } catch { /* optional */ }
  try { return require('../../../../packages/page-extract').extractPageContent; } catch { /* optional */ }
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
  collectPageState,
  sendKeysInPage,
  selectOptionInPage,
  navigateHistoryInPage,
  injectCssInPage,
  getOuterHtmlInPage,
  getPageInfoInPage,
  resolvePointInPage,
  resolveDragPointsInPage,
  selectTextInPage,
  zoomInPage,
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
    this.sessionTargets = new Map();
    this.downloads = new Map();
    this.pendingDialogs = new Map();
    this.networkInflight = new Map();
    this.tabZooms = new Map();
    this.recordings = new Map();
    this.child = null;
    this.userDataDir = null;
    this.stopped = false;
    this.reconnectDelay = 1000;
    this.wsUrl = null;
    this._cookieSessionIdCached = null;
  }

  async start() {
    this.stopped = false;
    const mode = this.config.launch?.enabled ? 'launch' : (this.config.mode || 'attach');
    this.wsUrl = await this._resolveWsUrl(mode);
    this._cookieSessionIdCached = null;
    await this._connect(this.wsUrl);
    this.reconnectDelay = 1000;
  }

  async stop() {
    this.stopped = true;
    for (const rec of this.recordings.values()) {
      if (rec.timer) clearTimeout(rec.timer);
      rec.stopped = true;
    }
    this.recordings.clear();
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
    await this._configureDownloads();
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

  async _configureDownloads() {
    try {
      const dir = getPaths().downloadsDir;
      fs.mkdirSync(dir, { recursive: true });
      await this.rpc.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: dir,
        eventsEnabled: true,
      });
    } catch {
      /* attach-mode Chrome may reject Browser.setDownloadBehavior */
    }
  }

  _onEvent(event) {
    const method = event.method;
    const params = event.params || {};
    const sessionId = event.sessionId;
    if (method === 'Target.targetCreated' && params.targetInfo) {
      this._rememberTarget(params.targetInfo);
      this._refreshTabs().catch(() => {});
    }
    if (method === 'Target.targetDestroyed' && params.targetId) {
      this.aliases.release(params.targetId);
      this.targets.delete(params.targetId);
      const session = this.sessions.get(params.targetId);
      this.sessions.delete(params.targetId);
      if (session) this.sessionTargets.delete(session);
      this.pendingDialogs.delete(params.targetId);
      this.tabZooms.delete(params.targetId);
      for (const [recId, rec] of this.recordings.entries()) {
        if (rec.targetId === params.targetId) {
          if (rec.timer) clearTimeout(rec.timer);
          rec.stopped = true;
          this.recordings.delete(recId);
        }
      }
      this._refreshTabs().catch(() => {});
    }
    if (method === 'Target.targetInfoChanged' && params.targetInfo) {
      this._rememberTarget(params.targetInfo);
      this._refreshTabs().catch(() => {});
    }
    if (method === 'Page.javascriptDialogOpening') {
      const targetId = this.sessionTargets.get(sessionId) || params.targetId;
      if (targetId) this.pendingDialogs.set(targetId, params);
    }
    if (method === 'Browser.downloadWillBegin') {
      this.downloads.set(params.guid, {
        id: params.guid,
        url: params.url,
        basename: params.suggestedFilename,
        state: 'in_progress',
        bytes: 0,
        mime: '',
      });
    }
    if (method === 'Browser.downloadProgress') {
      const rec = this.downloads.get(params.guid) || { id: params.guid };
      rec.state = params.state === 'completed' ? 'complete'
        : params.state === 'canceled' ? 'interrupted'
          : 'in_progress';
      rec.bytes = Number(params.receivedBytes || rec.bytes || 0);
      this.downloads.set(params.guid, rec);
    }
    if (method === 'Network.requestWillBeSent') {
      this._networkBump(sessionId, 1);
    }
    if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      this._networkBump(sessionId, -1);
    }
    if (method === 'Page.screencastFrame') {
      this._onScreencastFrame(sessionId, params);
    }
  }

  _networkBump(sessionId, delta) {
    const key = sessionId || 'browser';
    const next = Math.max(0, (this.networkInflight.get(key) || 0) + delta);
    this.networkInflight.set(key, next);
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
    if (sessionId) this.sessionTargets.set(sessionId, targetId);
    try { await this.rpc.send('Runtime.runIfWaitingForDebugger', {}, sessionId ? { sessionId } : {}); } catch { /* ignore */ }
    try { await this.rpc.send('Page.enable', {}, sessionId ? { sessionId } : {}); } catch { /* ignore */ }
    try { await this.rpc.send('Network.enable', {}, sessionId ? { sessionId } : {}); } catch { /* ignore */ }
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
        case 'set_cookies': {
          complete({
            type: 'set_cookies_complete',
            ...await this._setCookies(message),
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
            message.ref || '',
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
            message.ref || '',
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
            message.ref || '',
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
            message.condition || 'selector',
            message.match || '',
            message.ref || '',
          ]);
          if (message.networkIdle && result && result.success) {
            const idle = await this._waitNetworkIdle(targetId, Math.min(timeoutSec * 1000, 10000));
            if (idle) result.settledBy = 'networkIdle';
          }
          complete({ type: 'wait_for_complete', tabId: message.tabId, result });
          break;
        }
        case 'get_page_state': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._evaluate(targetId, collectPageState, [
            message.maxElements || 300,
            message.interactiveOnly !== false,
          ]);
          complete({ type: 'get_page_state_complete', tabId: message.tabId, result });
          break;
        }
        case 'send_keys': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._evaluate(targetId, sendKeysInPage, [
            message.keys,
            message.ref || '',
          ]);
          complete({ type: 'send_keys_complete', tabId: message.tabId, result });
          break;
        }
        case 'navigate_history': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._navigateHistory(targetId, message.direction);
          complete({ type: 'navigate_history_complete', tabId: message.tabId, result });
          break;
        }
        case 'select_option': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._evaluate(targetId, selectOptionInPage, [
            message.selector || '',
            message.value || '',
            message.label || '',
            message.index || 0,
            message.ref || '',
          ]);
          complete({ type: 'select_option_complete', tabId: message.tabId, result });
          break;
        }
        case 'handle_dialog': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._handleDialog(targetId, message);
          complete({ type: 'handle_dialog_complete', tabId: message.tabId, result });
          break;
        }
        case 'list_downloads':
          complete({
            type: 'list_downloads_complete',
            tabId: message.tabId,
            result: publicDownloadList([...this.downloads.values()]),
          });
          break;
        case 'wait_download': {
          const result = await this._waitDownload(message);
          complete({ type: 'wait_download_complete', tabId: message.tabId, result });
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
        case 'drag': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._drag(targetId, message);
          complete({ type: 'drag_complete', tabId: message.tabId, result });
          break;
        }
        case 'wheel': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._wheel(targetId, message);
          complete({ type: 'wheel_complete', tabId: message.tabId, result });
          break;
        }
        case 'select_text': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._evaluate(targetId, selectTextInPage, [message]);
          complete({ type: 'select_text_complete', tabId: message.tabId, result });
          break;
        }
        case 'set_zoom': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._setZoom(targetId, message.zoomFactor);
          complete({ type: 'set_zoom_complete', tabId: message.tabId, result });
          break;
        }
        case 'record_start': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._startRecording(targetId, message);
          complete({ type: 'record_start_complete', tabId: message.tabId, result });
          break;
        }
        case 'record_stop': {
          const targetId = this._requireTarget(message.tabId);
          const result = await this._stopRecording(targetId, message);
          complete({ type: 'record_stop_complete', tabId: message.tabId, result });
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

  async _navigateHistory(targetId, direction) {
    try {
      const hist = await this._sendPage(targetId, 'Page.getNavigationHistory', {});
      const current = Number(hist.currentIndex);
      const next = direction === 'forward' ? current + 1 : current - 1;
      const entry = Array.isArray(hist.entries) ? hist.entries[next] : null;
      if (!entry) {
        return this._evaluate(targetId, navigateHistoryInPage, [direction]);
      }
      await this._sendPage(targetId, 'Page.navigateToHistoryEntry', { entryId: entry.id });
      return { success: true, direction, url: entry.url || '' };
    } catch {
      return this._evaluate(targetId, navigateHistoryInPage, [direction]);
    }
  }

  async _drag(targetId, message) {
    const resolved = await this._evaluate(targetId, resolveDragPointsInPage, [message]);
    if (!resolved || resolved.success === false) {
      return resolved || { success: false, error: '无法解析拖拽起止坐标' };
    }
    const fromX = Number.isFinite(resolved.fromX) ? Number(resolved.fromX) : Number(message.fromX || 0);
    const fromY = Number.isFinite(resolved.fromY) ? Number(resolved.fromY) : Number(message.fromY || 0);
    const toX = Number.isFinite(resolved.toX)
      ? Number(resolved.toX)
      : (Number.isFinite(message.toX) ? Number(message.toX) : fromX + Number(message.deltaX || 0));
    const toY = Number.isFinite(resolved.toY)
      ? Number(resolved.toY)
      : (Number.isFinite(message.toY) ? Number(message.toY) : fromY + Number(message.deltaY || 0));
    const button = message.button === 'right' ? 'right' : (message.button === 'middle' ? 'middle' : 'left');
    const buttons = button === 'right' ? 2 : (button === 'middle' ? 4 : 1);
    const steps = Math.max(1, Math.min(120, Math.round(Number(message.steps) || 12)));
    const durationMs = Math.max(0, Math.min(15000, Math.round(message.durationMs == null ? 300 : Number(message.durationMs) || 0)));
    const stepDelay = steps > 0 ? Math.floor(durationMs / steps) : 0;

    await this._sendPage(targetId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: fromX,
      y: fromY,
      button: 'none',
      buttons: 0,
    });
    await this._sendPage(targetId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: fromX,
      y: fromY,
      button,
      buttons,
      clickCount: 1,
    });
    for (let i = 1; i <= steps; i++) {
      if (stepDelay > 0) await sleep(stepDelay);
      const ratio = i / steps;
      await this._sendPage(targetId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: fromX + (toX - fromX) * ratio,
        y: fromY + (toY - fromY) * ratio,
        button,
        buttons,
      });
    }
    await this._sendPage(targetId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: toX,
      y: toY,
      button,
      buttons: 0,
      clickCount: 1,
    });
    return {
      success: true,
      mode: 'cdp',
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY },
      button,
      steps,
      durationMs,
    };
  }

  async _wheel(targetId, message) {
    const resolved = await this._evaluate(targetId, resolvePointInPage, [message]);
    if (!resolved || resolved.success === false) {
      return resolved || { success: false, error: '无法解析滚轮位置' };
    }
    const x = Number.isFinite(resolved.x) ? Number(resolved.x) : Number(message.x || 0);
    const y = Number.isFinite(resolved.y) ? Number(resolved.y) : Number(message.y || 0);
    const deltaX = Number.isFinite(message.deltaX) ? Number(message.deltaX) : 0;
    const deltaY = Number.isFinite(message.deltaY) ? Number(message.deltaY) : 0;
    const steps = Math.max(1, Math.min(120, Math.round(Number(message.steps) || 1)));
    const defaultDur = steps > 1 ? 300 : 0;
    const durationMs = Math.max(0, Math.min(15000, Math.round(message.durationMs == null ? defaultDur : Number(message.durationMs) || 0)));
    const stepDelay = steps > 1 ? Math.floor(durationMs / steps) : 0;
    const modifiers = (message.altKey ? 1 : 0)
      | (message.ctrlKey ? 2 : 0)
      | (message.metaKey ? 4 : 0)
      | (message.shiftKey ? 8 : 0);

    for (let i = 0; i < steps; i++) {
      await this._sendPage(targetId, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x,
        y,
        deltaX: deltaX / steps,
        deltaY: deltaY / steps,
        modifiers,
      });
      if (i + 1 < steps && stepDelay > 0) await sleep(stepDelay);
    }
    return {
      success: true,
      mode: 'cdp',
      x,
      y,
      deltaX,
      deltaY,
      steps,
      durationMs,
    };
  }

  async _setZoom(targetId, zoomFactor) {
    if (zoomFactor == null) {
      return {
        success: true,
        zoomFactor: this.tabZooms.get(targetId) ?? 1,
        mode: 'cdp',
      };
    }
    const factor = Number(zoomFactor) === 0 ? 1 : Number(zoomFactor);
    if (!Number.isFinite(factor) || factor < 0.25 || factor > 5) {
      const err = /** @type {Error & { code?: string }} */ (new Error('zoomFactor must be between 0.25 and 5 (or 0 to reset)'));
      err.code = 'INVALID_ARGUMENT';
      throw err;
    }
    try {
      await this._sendPage(targetId, 'Emulation.setPageScaleFactor', { pageScaleFactor: factor });
      this.tabZooms.set(targetId, factor);
      return { success: true, zoomFactor: factor, mode: 'cdp' };
    } catch {
      const fallback = await this._evaluate(targetId, zoomInPage, [factor]);
      if (fallback && fallback.success) this.tabZooms.set(targetId, factor);
      return fallback;
    }
  }

  _onScreencastFrame(sessionId, params) {
    const ackSessionId = params && params.sessionId;
    if (ackSessionId != null && this.rpc && this.rpc.connected) {
      this.rpc.send(
        'Page.screencastFrameAck',
        { sessionId: ackSessionId },
        sessionId ? { sessionId } : {},
      ).catch(() => {});
    }
    const targetId = this.sessionTargets.get(sessionId);
    let active = null;
    for (const rec of this.recordings.values()) {
      if (rec.stopped) continue;
      if ((sessionId && rec.sessionId === sessionId) || (targetId && rec.targetId === targetId)) {
        active = rec;
        break;
      }
    }
    if (!active) return;
    const rawData = typeof params?.data === 'string' ? params.data : '';
    if (!rawData) return;
    const dataUrl = `data:image/${active.format};base64,${rawData}`;
    const byteSize = Buffer.byteLength(dataUrl, 'utf8');
    if (active.frames.length >= active.maxFrames || active.totalBytes + byteSize > active.maxBytes) {
      active.droppedFrames += 1;
      active.truncated = true;
      this._haltCdpScreencast(active);
      return;
    }
    const meta = params.metadata || {};
    const width = Number.isFinite(meta.deviceWidth) ? Math.round(meta.deviceWidth) : active.width;
    const height = Number.isFinite(meta.deviceHeight) ? Math.round(meta.deviceHeight) : active.height;
    active.width = width;
    active.height = height;
    active.totalBytes += byteSize;
    active.frames.push({
      index: active.frames.length,
      timestampMs: Math.max(0, Date.now() - active.startMono),
      dataUrl,
      width: width ?? null,
      height: height ?? null,
    });
  }

  _haltCdpScreencast(rec) {
    if (rec.stopped) return;
    rec.stopped = true;
    rec.stoppedAt = new Date().toISOString();
    rec.durationMs = Math.max(0, Date.now() - rec.startMono);
    if (rec.timer) {
      clearTimeout(rec.timer);
      rec.timer = null;
    }
    this._sendPage(rec.targetId, 'Page.stopScreencast', {}).catch(() => {});
  }

  async _startRecording(targetId, message) {
    for (const existing of this.recordings.values()) {
      if (existing.targetId === targetId && !existing.stopped) {
        const err = /** @type {Error & { code?: string }} */ (new Error('A recording is already active on this tab'));
        err.code = 'RECORDING_ALREADY_ACTIVE';
        throw err;
      }
    }
    const format = message.format === 'png' ? 'png' : 'jpeg';
    const quality = Number.isFinite(message.quality)
      ? Math.max(1, Math.min(100, Math.round(Number(message.quality))))
      : 80;
    const maxDurationSec = Number.isFinite(message.maxDurationSec)
      ? Math.max(0.5, Math.min(120, Number(message.maxDurationSec)))
      : 30;
    const maxFrames = Number.isFinite(message.maxFrames)
      ? Math.max(1, Math.min(1200, Math.round(Number(message.maxFrames))))
      : 300;
    const maxBytes = Number.isFinite(message.maxBytes)
      ? Math.max(65536, Math.min(67108864, Math.round(Number(message.maxBytes))))
      : 33554432;
    const everyNthFrame = Number.isFinite(message.everyNthFrame)
      ? Math.max(1, Math.min(60, Math.round(Number(message.everyNthFrame))))
      : (Number.isFinite(message.fps) && Number(message.fps) > 0 && Number(message.fps) < 60
        ? Math.max(1, Math.round(60 / Number(message.fps)))
        : 1);

    if (message.activate === true) {
      await this._sendPage(targetId, 'Page.bringToFront', {}).catch(() => {});
    }

    const sessionId = await this._sessionFor(targetId);
    const crypto = require('crypto');
    const recordingId = `rec_${crypto.randomUUID().slice(0, 12)}`;
    const startedAt = new Date().toISOString();
    const rec = {
      recordingId,
      tabId: Number(message.tabId),
      targetId,
      sessionId,
      format,
      quality,
      maxDurationSec,
      maxFrames,
      maxBytes,
      startedAt,
      stoppedAt: null,
      startMono: Date.now(),
      durationMs: 0,
      frames: [],
      totalBytes: 0,
      droppedFrames: 0,
      truncated: false,
      width: null,
      height: null,
      stopped: false,
      timer: null,
    };

    const startParams = { format, everyNthFrame };
    if (format === 'jpeg') startParams.quality = quality;
    if (Number.isFinite(message.maxWidth)) startParams.maxWidth = Math.round(Number(message.maxWidth));
    if (Number.isFinite(message.maxHeight)) startParams.maxHeight = Math.round(Number(message.maxHeight));

    this.recordings.set(recordingId, rec);
    try {
      await this._sendPage(targetId, 'Page.startScreencast', startParams);
    } catch (error) {
      this.recordings.delete(recordingId);
      throw error;
    }

    rec.timer = setTimeout(() => {
      rec.truncated = true;
      this._haltCdpScreencast(rec);
    }, Math.round(maxDurationSec * 1000));

    return {
      success: true,
      recordingId,
      tabId: rec.tabId,
      mode: 'screencast',
      format,
      everyNthFrame,
      maxDurationSec,
      maxFrames,
      startedAt,
    };
  }

  async _stopRecording(targetId, message) {
    let rec = message.recordingId ? this.recordings.get(String(message.recordingId)) : null;
    if (!rec && !message.recordingId) {
      for (const candidate of this.recordings.values()) {
        if (candidate.targetId === targetId) {
          rec = candidate;
          break;
        }
      }
    }
    if (!rec) {
      const err = /** @type {Error & { code?: string }} */ (new Error('No active recording found'));
      err.code = 'RECORDING_NOT_FOUND';
      throw err;
    }
    if (!rec.stopped) {
      rec.stopped = true;
      rec.stoppedAt = new Date().toISOString();
      rec.durationMs = Math.max(0, Date.now() - rec.startMono);
      if (rec.timer) {
        clearTimeout(rec.timer);
        rec.timer = null;
      }
      await this._sendPage(rec.targetId, 'Page.stopScreencast', {}).catch(() => {});
    }
    this.recordings.delete(rec.recordingId);
    return {
      success: true,
      recordingId: rec.recordingId,
      tabId: rec.tabId,
      mode: 'screencast',
      format: rec.format,
      startedAt: rec.startedAt,
      stoppedAt: rec.stoppedAt || new Date().toISOString(),
      durationMs: rec.durationMs,
      frameCount: rec.frames.length,
      droppedFrames: rec.droppedFrames,
      truncated: rec.truncated,
      width: rec.width,
      height: rec.height,
      totalBytes: rec.totalBytes,
      frames: rec.frames,
    };
  }

  async _handleDialog(targetId, message) {
    const pending = this.pendingDialogs.get(targetId);
    if (!pending) {
      const err = /** @type {Error & { code?: string }} */ (new Error('No JavaScript dialog is open'));
      err.code = 'NO_DIALOG';
      throw err;
    }
    await this._sendPage(targetId, 'Page.handleJavaScriptDialog', {
      accept: message.action === 'accept',
      promptText: message.promptText || '',
    });
    this.pendingDialogs.delete(targetId);
    return { success: true, action: message.action, type: pending.type || '' };
  }

  async _waitNetworkIdle(targetId, timeoutMs) {
    const sessionId = await this._sessionFor(targetId);
    const key = sessionId || 'browser';
    const deadline = Date.now() + Math.max(200, timeoutMs || 2000);
    let idleSince = this.networkInflight.get(key) ? 0 : Date.now();
    while (Date.now() < deadline) {
      if ((this.networkInflight.get(key) || 0) === 0) {
        if (!idleSince) idleSince = Date.now();
        if (Date.now() - idleSince >= 500) return true;
      } else {
        idleSince = 0;
      }
      await sleep(50);
    }
    return false;
  }

  async _waitDownload(message) {
    const timeoutSec = Number.isFinite(message.timeout) ? message.timeout : 30;
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const match = [...this.downloads.values()].find((item) => {
        if (message.id && item.id !== message.id) return false;
        if (message.basename && item.basename !== message.basename) return false;
        return item.state === 'complete';
      });
      if (match) return publicDownload(match);
      await sleep(150);
    }
    const err = /** @type {Error & { code?: string }} */ (new Error('Download wait timed out'));
    err.code = 'DOWNLOAD_TIMEOUT';
    throw err;
  }

  async _setCookies(message) {
    const classified = classifyCookies(message.cookies || []);
    const domain = String(message.domain || classified.cookies[0]?.domain || '').replace(/^\./, '');
    if (message.overwrite === 'replace' && domain) {
      const existing = await this._getCookies();
      const incoming = new Set(classified.cookies.map(cookieIdentity));
      for (const raw of existing) {
        const cookie = toCanonicalCookie(raw);
        if (!cookieMatchesDomain(cookie, domain, true)) continue;
        if (incoming.has(cookieIdentity(cookie))) continue;
        try {
          await this._sendCookieCommand('Network.deleteCookies', {
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path || '/',
          });
        } catch { /* skip deletes that the browser rejects */ }
      }
    }
    const reasons = classified.reasons.slice();
    let skipped = classified.skipped;
    if (classified.cookies.length === 0) {
      return publicCookieWriteResult({ set: 0, skipped, reasons });
    }
    try {
      await this.rpc.send('Storage.setCookies', {
        cookies: classified.cookies.map(toCdpSetCookie),
      });
      return publicCookieWriteResult({ set: classified.cookies.length, skipped, reasons });
    } catch {
      // Chrome 144+ browser targets expose Storage but not Network; older
      // endpoints and page sessions still use Network.setCookie.
    }
    let set = 0;
    for (const cookie of classified.cookies) {
      try {
        const result = await this._sendCookieCommand('Network.setCookie', toCdpSetCookie(cookie));
        if (result && result.success === false) {
          skipped += 1;
          reasons.push({ name: cookie.name, reason: 'set-failed' });
          continue;
        }
        set += 1;
      } catch {
        skipped += 1;
        reasons.push({ name: cookie.name, reason: 'set-failed' });
      }
    }
    return publicCookieWriteResult({ set, skipped, reasons });
  }

  async _getCookies(url) {
    try {
      const stored = await this.rpc.send('Storage.getCookies', {});
      return this._filterCookiesByUrl(stored.cookies || [], url);
    } catch {
      try {
        if (url) {
          const result = await this._sendCookieCommand('Network.getCookies', { urls: [url] });
          return result.cookies || [];
        }
        const result = await this._sendCookieCommand('Network.getAllCookies', {});
        return result.cookies || [];
      } catch {
        return [];
      }
    }
  }

  _filterCookiesByUrl(cookies, url) {
    if (!url || !Array.isArray(cookies)) return cookies || [];
    try {
      const host = new URL(url).hostname.toLowerCase();
      return cookies.filter((cookie) => {
        const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
        return domain === host || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
      });
    } catch {
      return cookies;
    }
  }

  async _sendCookieCommand(method, params) {
    try {
      return await this.rpc.send(method, params);
    } catch (error) {
      if (!String(error.message || '').includes("wasn't found")) throw error;
      const sessionId = await this._cookieSessionId();
      return this.rpc.send(method, params, sessionId ? { sessionId } : {});
    }
  }

  async _cookieSessionId() {
    if (this._cookieSessionIdCached) return this._cookieSessionIdCached;
    let targetId = null;
    for (const [id, info] of this.targets) {
      if (info && (info.type === 'page' || info.type === 'tab' || !info.type)) {
        targetId = id;
        break;
      }
    }
    if (!targetId) {
      const created = await this.rpc.send('Target.createTarget', { url: 'about:blank' });
      targetId = created.targetId;
      this.aliases.allocate(targetId);
      this.targets.set(targetId, { targetId, type: 'page', url: 'about:blank', title: '' });
    }
    const sessionId = await this._sessionFor(targetId);
    try {
      await this.rpc.send('Network.enable', {}, sessionId ? { sessionId } : {});
    } catch { /* older sessions */ }
    this._cookieSessionIdCached = sessionId;
    return sessionId;
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
