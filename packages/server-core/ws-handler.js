'use strict';

const crypto = require('crypto');
const { URL } = require('url');
const { REQUEST_TIMEOUT_MS } = require('@js-eyes/protocol');

let PolicyContextCtor = null;
function loadPolicyContext() {
  if (PolicyContextCtor !== null) return PolicyContextCtor;
  try {
    PolicyContextCtor = require('@js-eyes/client-sdk/policy').PolicyContext;
  } catch {
    PolicyContextCtor = false;
  }
  return PolicyContextCtor;
}

const ACTION_TOOL_MAP = {
  execute_script: 'executeScript',
  inject_script: 'executeScript',
  inject_css: 'injectCss',
  get_cookies: 'getCookies',
  get_cookies_by_domain: 'getCookiesByDomain',
  upload_file_to_tab: 'uploadFileToTab',
  open_url: 'openUrl',
};

function lookupTabUrlInState(state, tabId) {
  if (tabId == null) return null;
  const numeric = Number(tabId);
  for (const conn of state.extensionClients.values()) {
    if (!Array.isArray(conn.tabs)) continue;
    for (const tab of conn.tabs) {
      if (!tab) continue;
      const candidate = tab.id ?? tab.tabId;
      if (candidate != null && Number(candidate) === numeric) {
        return tab.url || tab.pendingUrl || null;
      }
    }
  }
  return null;
}

function getOrCreatePolicyForClient(state, clientId) {
  if (!state.security || state.security.enforcement === 'off') {
    return null;
  }
  const conn = state.automationClients.get(clientId);
  if (!conn) return null;
  if (conn.policy) return conn.policy;
  const Ctor = loadPolicyContext();
  if (!Ctor) return null;
  conn.policy = new Ctor({
    security: state.security,
    pendingEgressDir: state.pendingEgressDir || null,
    audit: state.audit || null,
    tabLookup: (tabId) => lookupTabUrlInState(state, tabId),
  });
  return conn.policy;
}

function feedPolicyFromResponse(state, clientId, action, data) {
  const conn = state.automationClients.get(clientId);
  const policy = conn && conn.policy;
  if (!policy) return;
  try {
    if (action === 'get_tabs' && data && Array.isArray(data.tabs)) {
      policy.recordTabs(data.tabs, data.activeTabId);
    } else if ((action === 'get_html' || action === 'get_plain_text') && data) {
      const html = typeof data === 'string' ? data : (data.html || data.content || '');
      if (html) policy.recordFetchedHtml(html);
    }
  } catch {}
}

function generateId() {
  return crypto.randomUUID();
}

function send(socket, data) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(data));
  }
}

function parseBrowserName(userAgent) {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (ua.includes('firefox') || ua.includes('gecko/')) return 'firefox';
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('chrome') || ua.includes('chromium')) return 'chrome';
  if (ua.includes('safari')) return 'safari';
  return 'unknown';
}

function getExtensionSummaries(state) {
  const summaries = [];
  for (const [clientId, conn] of state.extensionClients) {
    if (conn.socket.readyState !== 1) continue;
    summaries.push({
      clientId,
      browserName: conn.browserName,
      tabs: conn.tabs,
      activeTabId: conn.activeTabId,
      tabCount: conn.tabs.length,
      connectedAt: new Date(conn.createdAt).toISOString(),
    });
  }
  return summaries;
}

function handleConnection(socket, request, state, options = {}) {
  const clientAddress = `${request.socket.remoteAddress}:${request.socket.remotePort}`;
  const url = new URL(request.url, `ws://${request.headers.host || 'localhost'}`);
  const clientType = url.searchParams.get('type') || 'extension';
  const audit = options.audit || state.audit || null;
  const access = options.access || { anonymous: false };

  audit?.write?.('ws.accept', {
    clientType,
    remote: clientAddress,
    origin: request.headers.origin || null,
    anonymous: Boolean(access.anonymous),
    reason: access.reason || null,
  });

  if (clientType === 'automation') {
    setupAutomationClient(socket, clientAddress, state, { audit, access });
  } else {
    setupExtensionClient(socket, clientAddress, state, { audit, access });
  }
}

function setupExtensionClient(socket, clientAddress, state, options = {}) {
  const clientId = generateId();

  console.log(`[Extension] Connected: ${clientAddress} (${clientId})`);

  state.extensionClients.set(clientId, {
    socket,
    clientAddress,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    browserName: 'unknown',
    userAgent: null,
    tabs: [],
    activeTabId: null,
    anonymous: Boolean(options.access?.anonymous),
  });

  send(socket, {
    type: 'auth_result',
    success: true,
    clientId,
    sessionId: null,
    expiresIn: null,
    permissions: null,
  });

  socket.on('message', (raw) => {
    const conn = state.extensionClients.get(clientId);
    if (conn) conn.lastActivity = Date.now();
    handleExtensionMessage(raw, clientId, state);
  });

  socket.on('close', () => {
    console.log(`[Extension] Disconnected: ${clientAddress} (${clientId})`);
    state.extensionClients.delete(clientId);
  });

  socket.on('error', (err) => {
    console.error(`[Extension] Error ${clientId}: ${err.message}`);
    state.extensionClients.delete(clientId);
  });
}

function setupAutomationClient(socket, clientAddress, state, options = {}) {
  const clientId = generateId();

  console.log(`[Automation] Connected: ${clientAddress} (${clientId})`);

  state.automationClients.set(clientId, {
    socket,
    clientAddress,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    anonymous: Boolean(options.access?.anonymous),
  });

  send(socket, {
    type: 'connection_established',
    clientId,
    timestamp: new Date().toISOString(),
  });

  socket.on('message', (raw) => {
    const conn = state.automationClients.get(clientId);
    if (conn) conn.lastActivity = Date.now();
    Promise.resolve(handleAutomationMessage(raw, clientId, socket, state)).catch((err) => {
      console.error(`[Automation] handler error ${clientId}: ${err.message}`);
    });
  });

  socket.on('close', () => {
    console.log(`[Automation] Disconnected: ${clientAddress} (${clientId})`);
    state.automationClients.delete(clientId);
  });

  socket.on('error', (err) => {
    console.error(`[Automation] Error ${clientId}: ${err.message}`);
    state.automationClients.delete(clientId);
  });
}

function handleExtensionMessage(raw, clientId, state) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  if (data.type === 'request') {
    const action = data.action;
    const payload = data.payload || {};
    data = { type: action, requestId: data.requestId || payload.requestId, ...payload };
  }
  if (data.type === 'notification') {
    const action = data.action;
    const payload = data.payload || {};
    data = { type: action, ...payload };
  }

  switch (data.type) {
    case 'ping': {
      const conn = state.extensionClients.get(clientId);
      if (conn) send(conn.socket, { type: 'pong', timestamp: new Date().toISOString() });
      return;
    }
    case 'init': {
      const conn = state.extensionClients.get(clientId);
      if (conn) {
        conn.userAgent = data.userAgent || null;
        conn.browserName = parseBrowserName(data.userAgent);
        console.log(`[Extension] Init received: ${conn.browserName} (${clientId})`);
        send(conn.socket, {
          type: 'init_ack',
          status: 'ok',
          clientId,
          browserName: conn.browserName,
          serverConfig: {
            request: { defaultTimeout: REQUEST_TIMEOUT_MS },
          },
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }
    case 'data': {
      const conn = state.extensionClients.get(clientId);
      if (conn) {
        conn.tabs = data.tabs || data.payload?.tabs || [];
        conn.activeTabId = (data.active_tab_id || data.payload?.active_tab_id) ?? null;
      }
      return;
    }
    case 'error':
      handleExtensionError(data, state);
      return;
    default:
      break;
  }

  if (!data.requestId) return;

  const requestId = data.requestId;
  switch (data.type) {
    case 'open_url_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: 'open_url_complete',
        tabId: data.tabId,
        url: data.url,
        cookies: data.cookies || [],
        requestId,
      }, state);
      break;
    case 'close_tab_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: 'close_tab_complete',
        tabId: data.tabId,
        requestId,
      }, state);
      break;
    case 'tab_html_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: 'tab_html_complete',
        tabId: data.tabId,
        html: data.html,
        requestId,
      }, state);
      break;
    case 'execute_script_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: 'execute_script_complete',
        tabId: data.tabId,
        result: data.result,
        requestId,
      }, state);
      break;
    case 'inject_css_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: 'inject_css_complete',
        tabId: data.tabId,
        requestId,
      }, state);
      break;
    case 'get_cookies_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: 'get_cookies_complete',
        tabId: data.tabId,
        url: data.url,
        cookies: data.cookies || [],
        requestId,
      }, state);
      break;
    case 'upload_file_to_tab_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: 'upload_file_to_tab_complete',
        tabId: data.tabId,
        uploadedFiles: data.uploadedFiles || [],
        requestId,
      }, state);
      break;
    case 'get_cookies_by_domain_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: 'get_cookies_by_domain_complete',
        domain: data.domain,
        cookies: data.cookies || [],
        total: data.total || 0,
        requestId,
      }, state);
      break;
    case 'get_page_info_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: 'get_page_info_complete',
        tabId: data.tabId,
        data: data.data || {},
        requestId,
      }, state);
      break;
    default:
      break;
  }
}

function handleExtensionError(data, state) {
  const requestId = data.requestId;
  const message = data.message || 'Unknown error';
  console.error(`[Extension] Error: ${message}` + (requestId ? ` (req: ${requestId})` : ''));

  if (requestId) {
    resolveRequest(requestId, {
      status: 'error',
      type: 'error',
      message,
      code: data.code || 'EXTENSION_ERROR',
      requestId,
    }, state);
  }
}

const SENSITIVE_AUTOMATION_ACTIONS = new Set([
  'execute_script',
  'inject_css',
  'get_cookies',
  'get_cookies_by_domain',
  'upload_file_to_tab',
]);

async function handleAutomationMessage(raw, clientId, socket, state) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    send(socket, { type: 'error', message: 'Invalid JSON' });
    return;
  }

  const action = data.action || data.type;
  const requestId = data.requestId;
  const target = data.target || null;
  const conn = state.automationClients.get(clientId);

  if (state.audit && action) {
    state.audit.write(SENSITIVE_AUTOMATION_ACTIONS.has(action)
      ? 'automation.sensitive'
      : 'automation.invoke', {
      clientId,
      action,
      target,
      anonymous: Boolean(conn?.anonymous),
      hasCode: Boolean(data.code),
      hasCss: Boolean(data.css),
      domain: data.domain || null,
      tabId: data.tabId ?? null,
      enforcement: state.security?.enforcement || 'off',
    });
  }

  const toolName = ACTION_TOOL_MAP[action];
  if (toolName && state.security && state.security.enforcement !== 'off') {
    const policy = getOrCreatePolicyForClient(state, clientId);
    if (policy) {
      const params = {};
      if (data.url !== undefined) params.url = data.url;
      if (data.tabId !== undefined) params.tabId = data.tabId;
      if (data.code !== undefined) params.code = data.code;
      if (data.css !== undefined) params.css = data.css;
      if (data.domain !== undefined) params.domain = data.domain;
      if (data.files !== undefined) params.files = data.files;
      try {
        const decision = await policy.evaluate(toolName, params);
        if (decision.decision === 'soft-block' || decision.decision === 'deny') {
          state.audit?.write?.('automation.soft-block', {
            clientId, action, tool: toolName, rule: decision.rule,
            reasons: decision.reasons, rule_decision: 'soft-block',
            enforcement: state.security.enforcement,
          });
          send(socket, {
            type: `${action}_response`, requestId, status: 'error',
            code: 'POLICY_SOFT_BLOCK', message: '规则引擎拒绝此操作（soft-block）',
            rule: decision.rule, reasons: decision.reasons,
          });
          return;
        }
        if (decision.decision === 'pending-egress') {
          state.audit?.write?.('automation.pending-egress', {
            clientId, action, tool: toolName, rule: decision.rule,
            pendingId: decision.pendingId, rule_decision: 'pending-egress',
            enforcement: state.security.enforcement,
          });
          send(socket, {
            type: `${action}_response`, requestId, status: 'pending-egress',
            code: 'POLICY_PENDING_EGRESS',
            message: `出口未在允许列表中，已转为 pending-egress（id=${decision.pendingId}）`,
            pendingId: decision.pendingId, rule: decision.rule, reasons: decision.reasons,
          });
          return;
        }
      } catch (err) {
        state.audit?.write?.('automation.policy-error', {
          clientId, action, tool: toolName, error: err.message,
        });
      }
    }
  }

  switch (action) {
    case 'get_tabs': {
      const browsers = getExtensionSummaries(state);
      const allTabs = browsers.flatMap((browser) => browser.tabs);
      const lastBrowser = browsers[browsers.length - 1];
      const responseData = {
        browsers,
        tabs: allTabs,
        activeTabId: lastBrowser ? lastBrowser.activeTabId : null,
      };
      feedPolicyFromResponse(state, clientId, 'get_tabs', responseData);
      send(socket, {
        type: 'get_tabs_response',
        requestId,
        status: 'success',
        data: responseData,
      });
      break;
    }
    case 'list_clients': {
      const browsers = getExtensionSummaries(state);
      send(socket, {
        type: 'list_clients_response',
        requestId,
        status: 'success',
        data: { clients: browsers },
      });
      break;
    }
    case 'open_url':
      forwardToExtension('open_url', data, socket, state, ['url', 'tabId', 'windowId'], target, clientId);
      break;
    case 'close_tab':
      forwardToExtension('close_tab', data, socket, state, ['tabId'], target, clientId);
      break;
    case 'get_html':
      forwardToExtension('get_html', data, socket, state, ['tabId'], target, clientId);
      break;
    case 'execute_script':
      forwardToExtension('execute_script', data, socket, state, ['tabId', 'code'], target, clientId);
      break;
    case 'inject_css':
      forwardToExtension('inject_css', data, socket, state, ['tabId', 'css'], target, clientId);
      break;
    case 'get_cookies':
      forwardToExtension('get_cookies', data, socket, state, ['tabId'], target, clientId);
      break;
    case 'get_cookies_by_domain':
      forwardToExtension('get_cookies_by_domain', data, socket, state, ['domain', 'includeSubdomains'], target, clientId);
      break;
    case 'get_page_info':
      forwardToExtension('get_page_info', data, socket, state, ['tabId'], target, clientId);
      break;
    case 'upload_file_to_tab':
      forwardToExtension('upload_file_to_tab', data, socket, state, ['tabId', 'files', 'targetSelector'], target, clientId);
      break;
    default:
      send(socket, { type: 'error', requestId, message: `Unknown action: ${action}` });
      break;
  }
}

function forwardToExtension(type, data, automationSocket, state, fields, target, clientId = null) {
  const requestId = data.requestId || generateId();

  const ext = pickExtension(state, target);
  if (!ext) {
    const detail = target
      ? `No browser extension matching target "${target}"`
      : 'No browser extension connected';
    send(automationSocket, {
      type: `${type}_response`,
      requestId,
      status: 'error',
      message: detail,
    });
    return;
  }

  const msg = { type, requestId };
  for (const field of fields) {
    if (data[field] !== undefined) msg[field] = data[field];
  }

  send(ext.socket, msg);
  registerPending(requestId, automationSocket, type, state, clientId);
}

function pickExtension(state, target) {
  if (!target) {
    for (const [, conn] of state.extensionClients) {
      if (conn.socket.readyState === 1) return conn;
    }
    return null;
  }

  const byId = state.extensionClients.get(target);
  if (byId && byId.socket.readyState === 1) return byId;

  const lower = target.toLowerCase();
  for (const [, conn] of state.extensionClients) {
    if (conn.socket.readyState === 1 && conn.browserName === lower) return conn;
  }
  return null;
}

function registerPending(requestId, automationSocket, operationType, state, clientId = null) {
  const timeoutId = setTimeout(() => {
    const info = state.pendingResponses.get(requestId);
    if (!info) return;
    state.pendingResponses.delete(requestId);

    const timeoutResponse = {
      status: 'error',
      type: `${operationType}_timeout`,
      requestId,
      message: `Request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    };

    send(info.socket, { type: `${operationType}_response`, requestId, ...timeoutResponse });
    state.callbackResponses.set(requestId, timeoutResponse);
  }, REQUEST_TIMEOUT_MS);

  state.pendingResponses.set(requestId, {
    socket: automationSocket,
    timeoutId,
    operationType,
    clientId,
    createdAt: Date.now(),
  });
}

function resolveRequest(requestId, responseData, state) {
  state.callbackResponses.set(requestId, responseData);

  const info = state.pendingResponses.get(requestId);
  if (info) {
    clearTimeout(info.timeoutId);
    state.pendingResponses.delete(requestId);

    if (info.clientId && info.operationType && responseData && responseData.status === 'success') {
      if (info.operationType === 'get_html') {
        feedPolicyFromResponse(state, info.clientId, 'get_html', responseData);
      } else if (info.operationType === 'open_url') {
        feedPolicyFromResponse(state, info.clientId, 'get_tabs', {
          tabs: [{ id: responseData.tabId, url: responseData.url }],
          activeTabId: responseData.tabId,
        });
      }
    }

    const responseType = info.operationType
      ? `${info.operationType}_response`
      : responseData.type?.replace('_complete', '_response') || 'response';

    send(info.socket, { ...responseData, type: responseType, requestId });
  }
}

function startCleanup(state) {
  const responseTtl = 5 * 60 * 1000;

  return setInterval(() => {
    const cutoff = Date.now() - responseTtl;
    for (const [id, response] of state.callbackResponses) {
      const timestamp = response._storedAt || 0;
      if (timestamp < cutoff) state.callbackResponses.delete(id);
    }

    for (const [id, conn] of state.extensionClients) {
      if (conn.socket.readyState !== 1) state.extensionClients.delete(id);
    }
    for (const [id, conn] of state.automationClients) {
      if (conn.socket.readyState !== 1) state.automationClients.delete(id);
    }
  }, 30000);
}

function createState() {
  return {
    extensionClients: new Map(),
    automationClients: new Map(),
    pendingResponses: new Map(),
    callbackResponses: new Map(),
    audit: null,
    serverToken: null,
    security: null,
    pendingEgressDir: null,
  };
}

module.exports = {
  handleConnection,
  createState,
  startCleanup,
  getExtensionSummaries,
  REQUEST_TIMEOUT_MS,
  _internal: {
    parseBrowserName,
    pickExtension,
    send,
    generateId,
    forwardToExtension,
    handleExtensionMessage,
    handleAutomationMessage,
    setupExtensionClient,
    setupAutomationClient,
    registerPending,
    resolveRequest,
  },
};
