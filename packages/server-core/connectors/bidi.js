'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const {
  listOperationIdsForConnector,
  pageInteractCore,
} = require('@js-eyes/protocol');
const { JsonRpcSocket, waitForOpen } = require('./json-rpc-socket');
const { TabAliasMap } = require('./tab-alias');
const { assertLoopbackEndpoint, redactEndpoint } = require('./loopback');
const {
  classifyCookies,
  cookieIdentity,
  cookieMatchesDomain,
  publicCookieWriteResult,
  toBidiSetCookie,
  toCanonicalCookie,
} = require('./cookie-record');
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

function fromBidiRemoteValue(remote) {
  if (!remote || typeof remote !== 'object') return remote;
  switch (remote.type) {
    case 'undefined':
      return undefined;
    case 'null':
      return null;
    case 'string':
    case 'number':
    case 'boolean':
    case 'bigint':
      return remote.value;
    case 'array':
      return (remote.value || []).map(fromBidiRemoteValue);
    case 'object': {
      const obj = {};
      for (const pair of remote.value || []) {
        obj[pair[0]] = fromBidiRemoteValue(pair[1]);
      }
      return obj;
    }
    default:
      return Object.prototype.hasOwnProperty.call(remote, 'value') ? remote.value : null;
  }
}

class BidiConnector {
  constructor(options = {}) {
    this.config = options.config || {};
    this.security = options.security || {};
    this.state = options.state;
    this.audit = options.audit || null;
    this.logger = options.logger || console;
    this.clientId = options.clientId || null;
    this.rpc = null;
    this.aliases = new TabAliasMap();
    this.contexts = new Map();
    this.stopped = false;
    this.reconnectDelay = 1000;
  }

  async start() {
    this.stopped = false;
    assertLoopbackEndpoint(this.config.endpoint, {
      loopbackOnly: this.config.loopbackOnly !== false,
      allowRemoteBind: Boolean(this.security.allowRemoteBind),
      label: 'bidi',
    });
    const ws = new WebSocket(this.config.endpoint);
    await waitForOpen(ws, 30000, 'Waiting for Firefox BiDi session');
    this.rpc = new JsonRpcSocket(ws, {
      onEvent: (event) => this._onEvent(event),
    });
    ws.on('close', () => {
      if (this.clientId) unregisterBrowserClient(this.state, this.clientId);
      this.audit?.write?.('browser.connector.disconnect', {
        kind: 'bidi',
        clientId: this.clientId,
        endpoint: redactEndpoint(this.config.endpoint),
      });
      this._scheduleReconnect();
    });
    await this.rpc.send('session.new', { capabilities: {} });
    await this.rpc.send('session.subscribe', {
      events: [
        'browsingContext.contextCreated',
        'browsingContext.contextDestroyed',
      ],
    });
    const tree = await this.rpc.send('browsingContext.getTree', {});
    for (const item of tree.contexts || []) this._rememberContext(item);
    await this._refreshTabs();
    if (!this.clientId) this.clientId = crypto.randomUUID();
    registerBrowserClient(this.state, this.clientId, {
      kind: 'bidi',
      transport: 'bidi',
      browserName: 'firefox',
      capabilities: listOperationIdsForConnector('bidi'),
      tabs: this._tabList(),
      activeTabId: this._activeTabId(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isOpen: () => this.isOpen(),
      dispatch: (message) => this.dispatch(message),
      dispose: () => this.stop(),
    });
    this.audit?.write?.('browser.connector.connect', {
      kind: 'bidi',
      clientId: this.clientId,
      endpoint: redactEndpoint(this.config.endpoint),
    });
    this.reconnectDelay = 1000;
  }

  async stop() {
    this.stopped = true;
    if (this.clientId) unregisterBrowserClient(this.state, this.clientId);
    try { await this.rpc?.send('session.end', {}); } catch { /* ignore */ }
    if (this.rpc) this.rpc.close();
    this.rpc = null;
  }

  isOpen() {
    return !!(this.rpc && this.rpc.connected);
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    setTimeout(() => {
      if (this.stopped) return;
      this.start().catch((err) => {
        this.logger.warn?.(`[bidi] reconnect failed: ${err.message}`);
        this._scheduleReconnect();
      });
    }, delay);
  }

  _onEvent(event) {
    const method = event.method;
    const params = event.params || {};
    if (method === 'browsingContext.contextCreated') {
      this._rememberContext(params);
      this._refreshTabs();
    }
    if (method === 'browsingContext.contextDestroyed' && params.context) {
      this.aliases.release(params.context);
      this.contexts.delete(params.context);
      this._refreshTabs();
    }
  }

  _rememberContext(info) {
    const context = info.context || info.browsingContext;
    if (!context) return;
    this.aliases.allocate(context);
    this.contexts.set(context, {
      context,
      url: info.url || '',
      title: '',
    });
  }

  _tabList() {
    return [...this.contexts.values()].map((info) => {
      const id = this.aliases.allocate(info.context);
      return {
        id,
        tabId: id,
        tabKey: info.context,
        url: info.url || '',
        title: info.title || '',
      };
    });
  }

  _activeTabId() {
    const tabs = this._tabList();
    return tabs[0] ? tabs[0].id : null;
  }

  _refreshTabs() {
    const record = this.clientId && this.state.browserClients.get(this.clientId);
    if (record) {
      record.tabs = this._tabList();
      record.activeTabId = this._activeTabId();
      record.lastActivity = Date.now();
    }
  }

  _requireContext(tabId) {
    const context = this.aliases.resolve(tabId);
    if (!context) {
      const err = /** @type {Error & { code?: string }} */ (new Error(`The requested browser tab was not found: ${tabId}`));
      err.code = 'TAB_NOT_FOUND';
      throw err;
    }
    return context;
  }

  async _evaluate(context, fn, args) {
    const expression = `Promise.resolve((${fn.toString()}).apply(null, ${JSON.stringify(args || [])}))`;
    const result = await this.rpc.send('script.evaluate', {
      expression,
      target: { context },
      awaitPromise: true,
      resultOwnership: 'none',
    });
    if (result && result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'BiDi script.evaluate failed');
    }
    return fromBidiRemoteValue(result && result.result);
  }

  async dispatch(message) {
    const { type, requestId } = message;
    const resolve = require('../ws-handler')._internal.resolveRequest;
    const complete = (payload) => resolve(requestId, { status: 'success', requestId, ...payload }, this.state);
    const fail = (error) => resolve(requestId, {
      status: 'error',
      type: 'error',
      message: error.message,
      code: error.code || 'CONNECTOR_ERROR',
      requestId,
    }, this.state);

    try {
      switch (type) {
        case 'open_url': {
          let context = message.tabId != null ? this.aliases.resolve(message.tabId) : null;
          if (!context) {
            const created = await this.rpc.send('browsingContext.create', { type: 'tab' });
            context = created.context;
            this.aliases.allocate(context);
            this.contexts.set(context, { context, url: message.url, title: '' });
          }
          await this.rpc.send('browsingContext.navigate', {
            context,
            url: message.url,
            wait: 'complete',
          });
          complete({
            type: 'open_url_complete',
            tabId: this.aliases.allocate(context),
            url: message.url,
            cookies: [],
          });
          break;
        }
        case 'close_tab': {
          const context = this._requireContext(message.tabId);
          await this.rpc.send('browsingContext.close', { context });
          complete({ type: 'close_tab_complete', tabId: message.tabId });
          break;
        }
        case 'get_html': {
          const html = await this._evaluate(this._requireContext(message.tabId), getOuterHtmlInPage, []);
          complete({ type: 'tab_html_complete', tabId: message.tabId, html: html || '' });
          break;
        }
        case 'execute_script': {
          if (!this.security.allowRawEval) {
            const err = /** @type {Error & { code?: string }} */ (new Error('Raw JavaScript execution is disabled'));
            err.code = 'RAW_EVAL_DISABLED';
            throw err;
          }
          const result = await this._evaluate(this._requireContext(message.tabId), function run(code) {
            return (0, eval)(code);
          }, [message.code]);
          complete({ type: 'execute_script_complete', tabId: message.tabId, result });
          break;
        }
        case 'inject_css': {
          await this._evaluate(this._requireContext(message.tabId), injectCssInPage, [message.css]);
          complete({ type: 'inject_css_complete', tabId: message.tabId });
          break;
        }
        case 'get_cookies':
        case 'get_cookies_by_domain': {
          const filter = {};
          if (type === 'get_cookies_by_domain' && message.domain) {
            filter.domain = message.domain;
          }
          const result = await this.rpc.send('storage.getCookies', Object.keys(filter).length ? { filter } : {});
          let cookies = result.cookies || [];
          if (type === 'get_cookies_by_domain' && message.includeSubdomains === false) {
            cookies = cookies.filter((cookie) => String(cookie.domain || '').replace(/^\./, '') === message.domain);
          }
          if (type === 'get_cookies') {
            complete({ type: 'get_cookies_complete', tabId: message.tabId, url: '', cookies });
          } else {
            complete({
              type: 'get_cookies_by_domain_complete',
              domain: message.domain,
              cookies,
              total: cookies.length,
            });
          }
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
          const data = await this._evaluate(this._requireContext(message.tabId), getPageInfoInPage, []);
          complete({ type: 'get_page_info_complete', tabId: message.tabId, data: data || {} });
          break;
        }
        case 'click': {
          const result = await this._evaluate(this._requireContext(message.tabId), clickInPage, [
            message.selector || '*', message.text || '', message.index || 0,
          ]);
          complete({ type: 'click_complete', tabId: message.tabId, result });
          break;
        }
        case 'fill': {
          const result = await this._evaluate(this._requireContext(message.tabId), fillInPage, [
            message.selector, message.value || '', !!message.clearFirst, message.index || 0,
          ]);
          complete({ type: 'fill_complete', tabId: message.tabId, result });
          break;
        }
        case 'scroll': {
          const result = await this._evaluate(this._requireContext(message.tabId), scrollInPage, [
            message.target || 'bottom', message.selector || '', message.pixels || 0,
          ]);
          complete({ type: 'scroll_complete', tabId: message.tabId, result });
          break;
        }
        case 'wait_for': {
          const timeoutSec = Number.isFinite(message.timeout) ? message.timeout : 10;
          const result = await this._evaluate(this._requireContext(message.tabId), waitForInPage, [
            message.selector, timeoutSec * 1000, !!message.visible,
          ]);
          complete({ type: 'wait_for_complete', tabId: message.tabId, result });
          break;
        }
        case 'extract_page': {
          const extractPageContent = loadExtractPageContent();
          const result = await this._evaluate(this._requireContext(message.tabId), extractPageContent, [message]);
          complete({ type: 'extract_page_complete', tabId: message.tabId, result });
          break;
        }
        case 'upload_file_to_tab': {
          const context = this._requireContext(message.tabId);
          const selector = message.targetSelector || 'input[type="file"]';
          const owned = await this.rpc.send('script.evaluate', {
            expression: `document.querySelector(${JSON.stringify(selector)})`,
            target: { context },
            awaitPromise: false,
            resultOwnership: 'root',
          });
          const sharedId = owned && owned.result && owned.result.sharedId;
          if (!sharedId) throw new Error(`未找到文件控件: ${selector}`);
          const files = (message.files || []).map((file, index) => {
            const name = path.basename(file.name || `upload-${index}`);
            const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-bidi-')), name);
            fs.writeFileSync(dest, Buffer.from(file.base64 || '', 'base64'));
            return dest;
          });
          await this.rpc.send('input.setFiles', {
            context,
            element: { sharedId },
            files,
          });
          complete({
            type: 'upload_file_to_tab_complete',
            tabId: message.tabId,
            uploadedFiles: (message.files || []).map((file) => file.name),
          });
          break;
        }
        case 'capture_screenshot': {
          const context = this._requireContext(message.tabId);
          const shot = await this.rpc.send('browsingContext.captureScreenshot', { context });
          complete({
            type: 'capture_screenshot_complete',
            tabId: message.tabId,
            format: message.format || 'png',
            dataUrl: shot && shot.data ? `data:image/png;base64,${shot.data}` : null,
            fullPage: !!message.fullPage,
          });
          break;
        }
        default:
          throw new Error(`Unknown action: ${type}`);
      }
    } catch (error) {
      fail(error);
    }
  }

  async _setCookies(message) {
    const classified = classifyCookies(message.cookies || []);
    const domain = String(message.domain || classified.cookies[0]?.domain || '').replace(/^\./, '');
    if (message.overwrite === 'replace' && domain) {
      const existing = await this.rpc.send('storage.getCookies', {
        filter: { domain },
      });
      const incoming = new Set(classified.cookies.map(cookieIdentity));
      for (const raw of existing.cookies || []) {
        const cookie = toCanonicalCookie(raw);
        if (!cookieMatchesDomain(cookie, domain, true)) continue;
        if (incoming.has(cookieIdentity(cookie))) continue;
        try {
          await this.rpc.send('storage.deleteCookies', {
            filter: {
              name: cookie.name,
              domain: String(cookie.domain || '').replace(/^\./, ''),
              path: cookie.path || '/',
            },
          });
        } catch { /* skip deletes that the browser rejects */ }
      }
    }
    let set = 0;
    const reasons = classified.reasons.slice();
    let skipped = classified.skipped;
    for (const cookie of classified.cookies) {
      try {
        await this.rpc.send('storage.setCookie', toBidiSetCookie(cookie));
        set += 1;
      } catch {
        skipped += 1;
        reasons.push({ name: cookie.name, reason: 'set-failed' });
      }
    }
    return publicCookieWriteResult({ set, skipped, reasons });
  }
}

function createBidiConnector(options) {
  return new BidiConnector(options);
}

module.exports = {
  BidiConnector,
  createBidiConnector,
  fromBidiRemoteValue,
};
