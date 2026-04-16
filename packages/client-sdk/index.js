'use strict';

const WebSocket = require('ws');
const { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } = require('@js-eyes/protocol');
const {
  PolicyContext,
  TaskOriginTracker,
  TaintRegistry,
  EgressGate,
} = require('./policy');

const DEFAULT_SERVER_URL = `ws://${DEFAULT_SERVER_HOST}:${DEFAULT_SERVER_PORT}`;
const WS_SUBPROTOCOL_PREFIX = 'jse-token.';

class PolicyBlockError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'PolicyBlockError';
    this.code = info.code || 'POLICY_BLOCK';
    this.decision = info.decision;
    this.rule = info.rule;
    this.reasons = info.reasons || [];
    this.pendingId = info.pendingId || null;
    this.tool = info.tool || null;
  }
}

function tryReadServerToken() {
  try {
    const { readToken } = require('@js-eyes/runtime-paths/token');
    return readToken();
  } catch {
    return null;
  }
}

class BrowserAutomation {
  constructor(serverUrl, options = {}) {
    this.serverUrl = this._normalizeWsUrl(serverUrl || DEFAULT_SERVER_URL);
    this.logger = options.logger || console;
    this.defaultTimeout = options.defaultTimeout || 60;
    if (Object.prototype.hasOwnProperty.call(options, 'token')) {
      this.token = options.token || null;
    } else if (process.env.JS_EYES_SERVER_TOKEN) {
      this.token = process.env.JS_EYES_SERVER_TOKEN;
    } else {
      this.token = tryReadServerToken();
    }

    this.requestInterval = options.requestInterval || 200;
    this._lastRequestTime = 0;

    this.ws = null;
    this._wsState = 'disconnected';
    this._clientId = null;
    this._intentionalClose = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._maxReconnectDelay = 60000;
    this._connectPromise = null;

    this.pendingRequests = new Map();

    this.policy = options.policy || null;
    if (this.policy && typeof this.policy.setTabLookup === 'function') {
      this.policy.setTabLookup((tabId) => this._lookupTabUrl(tabId));
    }

    this._processCleanup = () => {
      try { this.disconnect(); } catch {}
    };
    process.on('SIGINT', this._processCleanup);
    process.on('SIGTERM', this._processCleanup);
    process.on('exit', this._processCleanup);
  }

  _normalizeWsUrl(url) {
    if (url.startsWith('http://')) return url.replace('http://', 'ws://');
    if (url.startsWith('https://')) return url.replace('https://', 'wss://');
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) return `ws://${url}`;
    return url;
  }

  async connect() {
    if (this._wsState === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this._connectPromise) {
      return this._connectPromise;
    }

    this._intentionalClose = false;

    this._connectPromise = new Promise((resolve, reject) => {
      this._wsState = 'connecting';
      const params = new URLSearchParams({ type: 'automation' });
      if (this.token) params.set('token', this.token);
      const wsUrl = `${this.serverUrl}?${params.toString()}`;

      const sanitizedUrl = `${this.serverUrl}?type=automation${this.token ? '&token=***' : ''}`;
      this.logger.info(`[JS-Eyes] 正在连接: ${sanitizedUrl}`);

      const protocols = this.token ? [WS_SUBPROTOCOL_PREFIX + this.token] : undefined;
      const wsOptions = this.token
        ? { headers: { Authorization: `Bearer ${this.token}` } }
        : undefined;

      try {
        this.ws = protocols
          ? new WebSocket(wsUrl, protocols, wsOptions)
          : new WebSocket(wsUrl, wsOptions);
      } catch (err) {
        this._wsState = 'disconnected';
        this._connectPromise = null;
        reject(new Error(`WebSocket 创建失败: ${err.message}`));
        return;
      }

      const connectTimeout = setTimeout(() => {
        if (this._wsState === 'connecting') {
          this.ws.terminate();
          this._wsState = 'disconnected';
          this._connectPromise = null;
          reject(new Error('WebSocket 连接超时 (10s)'));
        }
      }, 10000);

      this.ws.on('open', () => {
        this.logger.info('[JS-Eyes] TCP 连接已建立，等待服务端确认...');
      });

      this.ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === 'connection_established') {
          clearTimeout(connectTimeout);
          this._clientId = msg.clientId;
          this._wsState = 'connected';
          this._reconnectAttempts = 0;
          this._connectPromise = null;
          this.logger.info(`[JS-Eyes] 连接已建立 (clientId=${msg.clientId})`);

          this.ws.removeAllListeners('message');
          this.ws.on('message', (data) => this._handleMessage(data));
          resolve();
        }
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(connectTimeout);
        if (this._wsState === 'connecting') {
          this._wsState = 'disconnected';
          this.ws = null;
          this._connectPromise = null;
          reject(new Error(`WebSocket 连接关闭: code=${code}`));
        } else {
          this._handleWsClose(code, reason);
        }
      });

      this.ws.on('error', (err) => {
        this.logger.error(`[JS-Eyes] 连接错误: ${err.message}`);
      });
    });

    return this._connectPromise;
  }

  disconnect() {
    this._intentionalClose = true;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('WebSocket 连接已主动关闭'));
    }
    this.pendingRequests.clear();

    if (this.ws) {
      try { this.ws.close(1000, 'Client disconnect'); } catch {}
      this.ws = null;
    }

    this._wsState = 'disconnected';
    this._connectPromise = null;
    this._clientId = null;

    process.removeListener('SIGINT', this._processCleanup);
    process.removeListener('SIGTERM', this._processCleanup);
    process.removeListener('exit', this._processCleanup);

    this.logger.info('[JS-Eyes] 已断开连接');
  }

  async ensureConnected() {
    if (this._wsState === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    await this.connect();
  }

  _scheduleReconnect() {
    if (this._intentionalClose || this._reconnectTimer) return;

    this._reconnectAttempts++;
    const delay = Math.min(2000 * Math.pow(2, this._reconnectAttempts - 1), this._maxReconnectDelay);

    this.logger.info(`[JS-Eyes] 将在 ${delay}ms 后重连 (第 ${this._reconnectAttempts} 次)`);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        this.logger.error(`[JS-Eyes] 重连失败: ${err.message}`);
        this._scheduleReconnect();
      }
    }, delay);
  }

  _handleMessage(rawData) {
    let msg;
    try { msg = JSON.parse(rawData.toString()); } catch { return; }

    if (msg.type === 'error' && !msg.requestId) {
      this.logger.error(`[JS-Eyes] 服务端错误: ${msg.message || JSON.stringify(msg)}`);
      return;
    }

    if (msg.requestId) {
      const pending = this.pendingRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(msg.requestId);

        if (msg.status === 'error' || msg.type === 'error') {
          pending.reject(new Error(msg.message || '未知错误'));
        } else {
          pending.resolve(msg);
        }
      }
    }
  }

  _handleWsClose(code, reason) {
    this._wsState = 'disconnected';
    this.ws = null;
    this._clientId = null;

    this.logger.info(`[JS-Eyes] 连接关闭: code=${code}, reason=${reason || 'N/A'}`);

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('WebSocket 连接已断开'));
    }
    this.pendingRequests.clear();

    if (!this._intentionalClose) {
      this._scheduleReconnect();
    }
  }

  _generateRequestId() {
    return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  async _sendRequest(action, payload = {}, options = {}) {
    const now = Date.now();
    const wait = this.requestInterval - (now - this._lastRequestTime);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this._lastRequestTime = Date.now();

    await this.ensureConnected();

    const requestId = this._generateRequestId();
    const timeoutSec = options.timeout || this.defaultTimeout;

    const message = { type: action, requestId, ...payload };
    if (options.target) {
      message.target = options.target;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`请求超时: action=${action}, requestId=${requestId}, timeout=${timeoutSec}s`));
      }, timeoutSec * 1000);

      this.pendingRequests.set(requestId, { resolve, reject, timeoutId });

      try {
        this.ws.send(JSON.stringify(message));
      } catch (err) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        reject(new Error(`WebSocket 发送失败: ${err.message}`));
      }
    });
  }

  attachPolicy(policy) {
    this.policy = policy;
    if (policy && typeof policy.setTabLookup === 'function') {
      policy.setTabLookup((tabId) => this._lookupTabUrl(tabId));
    }
    return this;
  }

  async _lookupTabUrl(tabId) {
    try {
      const data = await this._sendRequest('get_tabs', {}, { timeout: 5 });
      const tabs = data?.data?.tabs || [];
      const target = tabs.find((t) => Number(t.id) === Number(tabId) || Number(t.tabId) === Number(tabId));
      if (!target) return null;
      return target.url || target.pendingUrl || null;
    } catch {
      return null;
    }
  }

  async _evaluatePolicy(toolName, params) {
    if (!this.policy || typeof this.policy.evaluate !== 'function') {
      return { decision: 'allow' };
    }
    return this.policy.evaluate(toolName, params);
  }

  _blockFromPolicy(result, toolName) {
    const err = new PolicyBlockError(
      result.decision === 'pending-egress'
        ? `出口未在允许列表中，已转为 pending-egress（id=${result.pendingId}）`
        : '规则引擎拒绝此操作（soft-block）',
      {
        tool: toolName,
        decision: result.decision,
        rule: result.rule,
        reasons: result.reasons,
        pendingId: result.pendingId,
      }
    );
    throw err;
  }

  async getTabs(options = {}) {
    const response = await this._sendRequest('get_tabs', {}, options);
    const data = response.data || { browsers: [], tabs: [], activeTabId: null };
    if (this.policy) {
      this.policy.recordTabs(data.tabs || [], data.activeTabId);
    }
    return data;
  }

  async listClients(options = {}) {
    const response = await this._sendRequest('list_clients', {}, options);
    return response.data?.clients || [];
  }

  async openUrl(url, tabId = null, windowId = null, options = {}) {
    const decision = await this._evaluatePolicy('openUrl', { url, tabId, windowId });
    if (decision.decision !== 'allow') {
      this._blockFromPolicy(decision, 'openUrl');
    }

    const payload = { url };
    if (tabId !== null) payload.tabId = parseInt(tabId, 10);
    if (windowId !== null) payload.windowId = parseInt(windowId, 10);

    const response = await this._sendRequest('open_url', payload, options);
    if (this.policy && response?.tabId && url) {
      this.policy.recordTabs([{ id: response.tabId, url }]);
      this.policy.egress.allowSession(url);
    }
    return response.tabId;
  }

  async closeTab(tabId, options = {}) {
    await this._sendRequest('close_tab', { tabId: parseInt(tabId, 10) }, options);
  }

  async getTabHtml(tabId, options = {}) {
    const response = await this._sendRequest('get_html', { tabId: parseInt(tabId, 10) }, options);
    const html = response.html;
    if (this.policy && html) {
      this.policy.recordFetchedHtml(html);
    }
    return html;
  }

  async executeScript(tabId, code, options = {}) {
    if (typeof options === 'number') options = { timeout: options };
    const decision = await this._evaluatePolicy('executeScript', { tabId, code });
    if (decision.decision !== 'allow') {
      this._blockFromPolicy(decision, 'executeScript');
    }
    const response = await this._sendRequest('execute_script', {
      tabId: parseInt(tabId, 10),
      code,
    }, options);
    return response.result;
  }

  async injectCss(tabId, css, options = {}) {
    const decision = await this._evaluatePolicy('injectCss', { tabId, css });
    if (decision.decision !== 'allow') {
      this._blockFromPolicy(decision, 'injectCss');
    }
    await this._sendRequest('inject_css', {
      tabId: parseInt(tabId, 10),
      css,
    }, options);
  }

  async getCookies(tabId, options = {}) {
    const decision = await this._evaluatePolicy('getCookies', { tabId });
    if (decision.decision !== 'allow') {
      this._blockFromPolicy(decision, 'getCookies');
    }
    const response = await this._sendRequest('get_cookies', { tabId: parseInt(tabId, 10) }, options);
    const cookies = response.cookies || [];
    if (this.policy) {
      return this.policy.tagCookiesReturn(cookies, { source: 'getCookies', tabId });
    }
    return cookies;
  }

  async getCookiesByDomain(domain, options = {}) {
    const decision = await this._evaluatePolicy('getCookiesByDomain', { domain });
    if (decision.decision !== 'allow') {
      this._blockFromPolicy(decision, 'getCookiesByDomain');
    }
    const payload = { domain };
    if (options.includeSubdomains !== undefined) {
      payload.includeSubdomains = options.includeSubdomains;
    }
    const response = await this._sendRequest('get_cookies_by_domain', payload, options);
    const cookies = response.cookies || [];
    if (this.policy) {
      return this.policy.tagCookiesReturn(cookies, { source: 'getCookiesByDomain', domain });
    }
    return cookies;
  }

  async getPageInfo(tabId, options = {}) {
    const response = await this._sendRequest('get_page_info', { tabId: parseInt(tabId, 10) }, options);
    return response.data || {};
  }

  async uploadFileToTab(tabId, files, options = {}) {
    const decision = await this._evaluatePolicy('uploadFileToTab', { tabId, files });
    if (decision.decision !== 'allow') {
      this._blockFromPolicy(decision, 'uploadFileToTab');
    }
    const payload = {
      tabId: parseInt(tabId, 10),
      files,
    };
    if (options.targetSelector) {
      payload.targetSelector = options.targetSelector;
    }
    const response = await this._sendRequest('upload_file_to_tab', payload, options);
    return response.uploadedFiles || [];
  }
}

module.exports = {
  BrowserAutomation,
  PolicyContext,
  TaskOriginTracker,
  TaintRegistry,
  EgressGate,
  PolicyBlockError,
};
