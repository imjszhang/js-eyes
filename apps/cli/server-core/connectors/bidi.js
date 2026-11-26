'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
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
  toBidiSetCookie,
  toCanonicalCookie,
} = require('./cookie-record');
const { registerBrowserClient, unregisterBrowserClient } = require('./registry');
const { publicDownload, publicDownloadList } = require('./download-record');

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
  dragInPage,
  wheelInPage,
  selectTextInPage,
  zoomInPage,
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
    this.downloads = new Map();
    this.pendingDialogs = new Map();
    this.recordings = new Map();
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
        'browsingContext.userPromptOpened',
        'browsingContext.downloadWillBegin',
        'browsingContext.downloadEnd',
      ],
    }).catch(() => this.rpc.send('session.subscribe', {
      events: [
        'browsingContext.contextCreated',
        'browsingContext.contextDestroyed',
      ],
    }));
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
    for (const rec of this.recordings.values()) {
      rec.stopped = true;
      if (rec.timer) clearTimeout(rec.timer);
      if (rec.deadlineTimer) clearTimeout(rec.deadlineTimer);
    }
    this.recordings.clear();
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
      this.pendingDialogs.delete(params.context);
      this._refreshTabs();
    }
    if (method === 'browsingContext.userPromptOpened' && params.context) {
      this.pendingDialogs.set(params.context, params);
    }
    if (method === 'browsingContext.downloadWillBegin') {
      const id = params.downloadId || params.context || crypto.randomUUID();
      this.downloads.set(id, {
        id,
        url: params.url,
        basename: params.suggestedFilename || params.filename,
        state: 'in_progress',
        bytes: 0,
        mime: '',
      });
    }
    if (method === 'browsingContext.downloadEnd') {
      const id = params.downloadId || params.context;
      const rec = this.downloads.get(id) || { id };
      rec.state = params.status === 'canceled' ? 'interrupted' : 'complete';
      rec.bytes = Number(params.bytes || rec.bytes || 0);
      rec.basename = rec.basename || params.filepath || params.filename;
      this.downloads.set(id, rec);
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
            message.selector || '*', message.text || '', message.index || 0, message.ref || '',
          ]);
          complete({ type: 'click_complete', tabId: message.tabId, result });
          break;
        }
        case 'fill': {
          const result = await this._evaluate(this._requireContext(message.tabId), fillInPage, [
            message.selector, message.value || '', !!message.clearFirst, message.index || 0, message.ref || '',
          ]);
          complete({ type: 'fill_complete', tabId: message.tabId, result });
          break;
        }
        case 'scroll': {
          const result = await this._evaluate(this._requireContext(message.tabId), scrollInPage, [
            message.target || 'bottom', message.selector || '', message.pixels || 0, message.ref || '',
          ]);
          complete({ type: 'scroll_complete', tabId: message.tabId, result });
          break;
        }
        case 'wait_for': {
          const timeoutSec = Number.isFinite(message.timeout) ? message.timeout : 10;
          const result = await this._evaluate(this._requireContext(message.tabId), waitForInPage, [
            message.selector, timeoutSec * 1000, !!message.visible,
            message.condition || 'selector', message.match || '', message.ref || '',
          ]);
          if (result && message.networkIdle && result.success && result.settledBy === 'load') {
            result.settledBy = 'load';
          }
          complete({ type: 'wait_for_complete', tabId: message.tabId, result });
          break;
        }
        case 'get_page_state': {
          const result = await this._evaluate(this._requireContext(message.tabId), collectPageState, [
            message.maxElements || 300,
            message.interactiveOnly !== false,
          ]);
          complete({ type: 'get_page_state_complete', tabId: message.tabId, result });
          break;
        }
        case 'send_keys': {
          const result = await this._evaluate(this._requireContext(message.tabId), sendKeysInPage, [
            message.keys, message.ref || '',
          ]);
          complete({ type: 'send_keys_complete', tabId: message.tabId, result });
          break;
        }
        case 'navigate_history': {
          const context = this._requireContext(message.tabId);
          let result;
          try {
            await this.rpc.send('browsingContext.traverseHistory', {
              context,
              delta: message.direction === 'forward' ? 1 : -1,
            });
            result = { success: true, direction: message.direction };
          } catch {
            result = await this._evaluate(context, navigateHistoryInPage, [message.direction]);
          }
          complete({ type: 'navigate_history_complete', tabId: message.tabId, result });
          break;
        }
        case 'select_option': {
          const result = await this._evaluate(this._requireContext(message.tabId), selectOptionInPage, [
            message.selector || '', message.value || '', message.label || '', message.index || 0, message.ref || '',
          ]);
          complete({ type: 'select_option_complete', tabId: message.tabId, result });
          break;
        }
        case 'handle_dialog': {
          const context = this._requireContext(message.tabId);
          const pending = this.pendingDialogs.get(context);
          if (!pending) {
            const err = /** @type {Error & { code?: string }} */ (new Error('No JavaScript dialog is open'));
            err.code = 'NO_DIALOG';
            throw err;
          }
          try {
            await this.rpc.send('browsingContext.handleUserPrompt', {
              context,
              accept: message.action === 'accept',
              userText: message.promptText || '',
            });
          } catch (error) {
            const err = /** @type {Error & { code?: string }} */ (new Error(error.message));
            err.code = 'CAPABILITY_UNSUPPORTED';
            throw err;
          }
          this.pendingDialogs.delete(context);
          complete({
            type: 'handle_dialog_complete',
            tabId: message.tabId,
            result: { success: true, action: message.action },
          });
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
          const timeoutSec = Number.isFinite(message.timeout) ? message.timeout : 30;
          const deadline = Date.now() + timeoutSec * 1000;
          let match = null;
          while (Date.now() < deadline) {
            match = [...this.downloads.values()].find((item) => {
              if (message.id && item.id !== message.id) return false;
              if (message.basename && item.basename !== message.basename) return false;
              return item.state === 'complete';
            });
            if (match) break;
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          if (!match) {
            const err = /** @type {Error & { code?: string }} */ (new Error('Download wait timed out'));
            err.code = 'DOWNLOAD_TIMEOUT';
            throw err;
          }
          complete({ type: 'wait_download_complete', tabId: message.tabId, result: publicDownload(match) });
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
        case 'drag': {
          const result = await this._evaluate(this._requireContext(message.tabId), dragInPage, [message]);
          complete({ type: 'drag_complete', tabId: message.tabId, result });
          break;
        }
        case 'wheel': {
          const result = await this._evaluate(this._requireContext(message.tabId), wheelInPage, [message]);
          complete({ type: 'wheel_complete', tabId: message.tabId, result });
          break;
        }
        case 'select_text': {
          const result = await this._evaluate(this._requireContext(message.tabId), selectTextInPage, [message]);
          complete({ type: 'select_text_complete', tabId: message.tabId, result });
          break;
        }
        case 'set_zoom': {
          const result = await this._evaluate(this._requireContext(message.tabId), zoomInPage, [message.zoomFactor ?? null]);
          complete({ type: 'set_zoom_complete', tabId: message.tabId, result });
          break;
        }
        case 'record_start': {
          const context = this._requireContext(message.tabId);
          const result = await this._startRecording(context, message);
          complete({ type: 'record_start_complete', tabId: message.tabId, result });
          break;
        }
        case 'record_stop': {
          const context = this._requireContext(message.tabId);
          const result = await this._stopRecording(context, message);
          complete({ type: 'record_stop_complete', tabId: message.tabId, result });
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

  async _captureBidiFrame(rec) {
    if (rec.stopped) return;
    if (rec.frames.length >= rec.maxFrames) {
      rec.droppedFrames += 1;
      rec.truncated = true;
      rec.stopped = true;
      return;
    }
    try {
      const shot = await this.rpc.send('browsingContext.captureScreenshot', { context: rec.context });
      if (!shot || !shot.data) {
        rec.droppedFrames += 1;
        return;
      }
      const dataUrl = `data:image/png;base64,${shot.data}`;
      const byteSize = Buffer.byteLength(dataUrl, 'utf8');
      if (rec.totalBytes + byteSize > rec.maxBytes) {
        rec.droppedFrames += 1;
        rec.truncated = true;
        rec.stopped = true;
        return;
      }
      rec.totalBytes += byteSize;
      rec.frames.push({
        index: rec.frames.length,
        timestampMs: Math.max(0, Date.now() - rec.startMono),
        dataUrl,
        width: null,
        height: null,
      });
    } catch {
      rec.droppedFrames += 1;
    }
  }

  async _startRecording(context, message) {
    for (const existing of this.recordings.values()) {
      if (existing.context === context && !existing.stopped) {
        const err = /** @type {Error & { code?: string }} */ (new Error('A recording is already active on this tab'));
        err.code = 'RECORDING_ALREADY_ACTIVE';
        throw err;
      }
    }
    const requestedFps = Number.isFinite(message.fps) && Number(message.fps) > 0 ? Number(message.fps) : 5;
    const effectiveFps = Math.max(0.5, Math.min(10, requestedFps));
    const intervalMs = Math.max(100, Math.round(1000 / effectiveFps));
    const maxDurationSec = Number.isFinite(message.maxDurationSec)
      ? Math.max(0.5, Math.min(120, Number(message.maxDurationSec)))
      : 30;
    const maxFrames = Number.isFinite(message.maxFrames)
      ? Math.max(1, Math.min(1200, Math.round(Number(message.maxFrames))))
      : 300;
    const maxBytes = Number.isFinite(message.maxBytes)
      ? Math.max(65536, Math.min(67108864, Math.round(Number(message.maxBytes))))
      : 33554432;
    const recordingId = `rec_${crypto.randomUUID().slice(0, 12)}`;
    const startedAt = new Date().toISOString();
    const rec = {
      recordingId,
      tabId: Number(message.tabId),
      context,
      format: 'png',
      effectiveFps,
      intervalMs,
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
      stopped: false,
      timer: null,
      deadlineTimer: null,
      inflight: null,
    };
    this.recordings.set(recordingId, rec);
    rec.inflight = this._captureBidiFrame(rec);
    await rec.inflight;
    rec.inflight = null;

    const scheduleNext = () => {
      if (rec.stopped) return;
      rec.timer = setTimeout(async () => {
        rec.timer = null;
        if (rec.stopped) return;
        rec.inflight = this._captureBidiFrame(rec);
        await rec.inflight;
        rec.inflight = null;
        scheduleNext();
      }, rec.intervalMs);
    };
    scheduleNext();

    rec.deadlineTimer = setTimeout(() => {
      rec.truncated = true;
      rec.stopped = true;
      rec.stoppedAt = new Date().toISOString();
      rec.durationMs = Math.max(0, Date.now() - rec.startMono);
      if (rec.timer) {
        clearTimeout(rec.timer);
        rec.timer = null;
      }
    }, Math.round(maxDurationSec * 1000));

    return {
      success: true,
      recordingId,
      tabId: rec.tabId,
      mode: 'bidi_screenshot',
      format: 'png',
      effectiveFps,
      maxDurationSec,
      maxFrames,
      startedAt,
    };
  }

  async _stopRecording(context, message) {
    let rec = message.recordingId ? this.recordings.get(String(message.recordingId)) : null;
    if (!rec && !message.recordingId) {
      for (const candidate of this.recordings.values()) {
        if (candidate.context === context) {
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
    }
    if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    if (rec.deadlineTimer) { clearTimeout(rec.deadlineTimer); rec.deadlineTimer = null; }
    if (rec.inflight) await rec.inflight.catch(() => {});
    this.recordings.delete(rec.recordingId);
    return {
      success: true,
      recordingId: rec.recordingId,
      tabId: rec.tabId,
      mode: 'bidi_screenshot',
      format: rec.format,
      startedAt: rec.startedAt,
      stoppedAt: rec.stoppedAt || new Date().toISOString(),
      durationMs: rec.durationMs,
      frameCount: rec.frames.length,
      droppedFrames: rec.droppedFrames,
      truncated: rec.truncated,
      width: null,
      height: null,
      totalBytes: rec.totalBytes,
      frames: rec.frames,
    };
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
