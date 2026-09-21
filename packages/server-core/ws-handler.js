'use strict';

const crypto = require('crypto');
const { URL } = require('url');
const {
  ACTION_POLICY_TOOL_MAP,
  BROWSER_OPERATION_BY_WIRE_ACTION,
  REQUEST_TIMEOUT_MS,
  SENSITIVE_BROWSER_ACTIONS,
  isOperationSupportedByConnector,
} = require('@js-eyes/protocol');
const {
  createExtensionClientsView,
  getBrowserSummaries,
  getClientId,
  isClientOpen,
  pickBrowserClient,
} = require('./connectors/registry');
const { publicCookieWriteResult } = require('./connectors/cookie-record');
const { syncCookiesBetweenClients } = require('./cookie-sync');

let PolicyContextCtor = null;
function loadPolicyContext() {
  if (PolicyContextCtor !== null) return PolicyContextCtor;
  try {
    PolicyContextCtor = require('@js-eyes/policy').PolicyContext;
  } catch {
    PolicyContextCtor = false;
  }
  return PolicyContextCtor;
}

const ACTION_TOOL_MAP = {
  ...ACTION_POLICY_TOOL_MAP,
  inject_script: 'executeScript',
};

function lookupTabUrlInState(state, tabId) {
  if (tabId == null) return null;
  const numeric = Number(tabId);
  const clients = state.browserClients || state.extensionClients;
  for (const conn of clients.values()) {
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
  // Generation counter lets `server.reloadSecurity()` invalidate cached
  // per-connection policies by bumping `state.policyGeneration`. Session-level
  // approvals held inside the old `PolicyContext` (e.g. `allowSession`) are
  // dropped on rebuild; this is documented in SKILL.md as the MVP caveat.
  const currentGeneration = Number.isFinite(state.policyGeneration) ? state.policyGeneration : 1;
  if (conn.policy) {
    if (conn.policyGeneration === currentGeneration) {
      return conn.policy;
    }
    const previousGeneration = conn.policyGeneration;
    conn.policy = null;
    state.audit?.write?.('automation.policy-rebuilt', {
      clientId,
      previousGeneration: previousGeneration ?? null,
      generation: currentGeneration,
    });
  }
  const Ctor = loadPolicyContext();
  if (!Ctor) return null;
  conn.policy = new Ctor({
    security: state.security,
    pendingEgressDir: state.pendingEgressDir || null,
    audit: state.audit || null,
    tabLookup: (tabId) => lookupTabUrlInState(state, tabId),
  });
  conn.policyGeneration = currentGeneration;
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
  return getBrowserSummaries(state);
}

function prewarmPolicyFromTargetExtension(policy, state, target) {
  if (!policy || typeof policy.recordTabs !== 'function') return;
  const ext = pickBrowserClient(state, target || null);
  if (!ext || !Array.isArray(ext.tabs) || ext.tabs.length === 0) return;
  try {
    policy.recordTabs(ext.tabs, ext.activeTabId);
  } catch {}
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
            request: { defaultTimeout: state.requestTimeoutMs || REQUEST_TIMEOUT_MS },
            security: {
              allowRawEval: !!(state.security && state.security.allowRawEval),
            },
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
    case 'click_complete':
    case 'fill_complete':
    case 'scroll_complete':
    case 'wait_for_complete':
    case 'extract_page_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: data.type,
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
    case 'set_cookies_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: 'set_cookies_complete',
        ...publicCookieWriteResult(data),
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
    case 'capture_screenshot_complete':
      resolveRequest(requestId, {
        status: 'success',
        type: 'capture_screenshot_complete',
        tabId: data.tabId,
        windowId: data.windowId ?? null,
        format: data.format || null,
        dataUrl: data.dataUrl || null,
        width: data.width ?? null,
        height: data.height ?? null,
        fullPage: !!data.fullPage,
        pageWidth: data.pageWidth ?? null,
        pageHeight: data.pageHeight ?? null,
        viewportWidth: data.viewportWidth ?? null,
        viewportHeight: data.viewportHeight ?? null,
        devicePixelRatio: data.devicePixelRatio ?? null,
        segments: Array.isArray(data.segments) ? data.segments : [],
        skipped: data.skipped || null,
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

const SENSITIVE_AUTOMATION_ACTIONS = new Set(SENSITIVE_BROWSER_ACTIONS);

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
      hasCookies: Array.isArray(data.cookies) && data.cookies.length > 0,
      domain: data.domain || null,
      source: data.source || null,
      destination: data.destination || null,
      tabId: data.tabId ?? null,
      enforcement: state.security?.enforcement || 'off',
      evalKind: action === 'execute_script'
        ? 'arbitrary_eval'
        : action === 'extract_page'
          ? 'controlled_extract'
          : undefined,
    });
  }

  const toolName = ACTION_TOOL_MAP[action];
  if (toolName && state.security && state.security.enforcement !== 'off') {
    const policy = getOrCreatePolicyForClient(state, clientId);
    if (policy) {
      prewarmPolicyFromTargetExtension(policy, state, target);
      const params = {};
      if (data.url !== undefined) params.url = data.url;
      if (data.tabId !== undefined) params.tabId = data.tabId;
      if (data.code !== undefined) params.code = data.code;
      if (data.css !== undefined) params.css = data.css;
      if (data.domain !== undefined) params.domain = data.domain;
      if (data.files !== undefined) params.files = data.files;
      if (data.cookies !== undefined) params.cookies = data.cookies;
      if (data.source !== undefined) params.source = data.source;
      if (data.destination !== undefined) params.destination = data.destination;
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
      let browsers = getBrowserSummaries(state);
      if (target) {
        const picked = pickBrowserClient(state, target);
        const pickedId = getClientId(state, picked);
        browsers = pickedId ? browsers.filter((browser) => browser.clientId === pickedId) : [];
      }
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
      const browsers = getBrowserSummaries(state);
      send(socket, {
        type: 'list_clients_response',
        requestId,
        status: 'success',
        data: { clients: browsers },
      });
      break;
    }
    case 'open_url':
      dispatchToBrowser('open_url', data, socket, state, ['url', 'tabId', 'windowId'], target, clientId);
      break;
    case 'close_tab':
      dispatchToBrowser('close_tab', data, socket, state, ['tabId'], target, clientId);
      break;
    case 'get_html':
      dispatchToBrowser('get_html', data, socket, state, ['tabId'], target, clientId);
      break;
    case 'execute_script':
      dispatchToBrowser('execute_script', data, socket, state, ['tabId', 'code'], target, clientId);
      break;
    case 'inject_css':
      dispatchToBrowser('inject_css', data, socket, state, ['tabId', 'css'], target, clientId);
      break;
    case 'get_cookies':
      dispatchToBrowser('get_cookies', data, socket, state, ['tabId'], target, clientId);
      break;
    case 'get_cookies_by_domain':
      dispatchToBrowser('get_cookies_by_domain', data, socket, state, ['domain', 'includeSubdomains'], target, clientId);
      break;
    case 'set_cookies':
      dispatchToBrowser('set_cookies', data, socket, state, ['cookies', 'overwrite', 'domain'], target, clientId);
      break;
    case 'sync_cookies':
      await handleSyncCookies(data, socket, state, clientId);
      break;
    case 'get_page_info':
      dispatchToBrowser('get_page_info', data, socket, state, ['tabId'], target, clientId);
      break;
    case 'click':
      dispatchToBrowser('click', data, socket, state, ['tabId', 'selector', 'text', 'index'], target, clientId);
      break;
    case 'fill':
      dispatchToBrowser('fill', data, socket, state, ['tabId', 'selector', 'value', 'clearFirst', 'index'], target, clientId);
      break;
    case 'scroll':
      dispatchToBrowser('scroll', data, socket, state, ['tabId', 'target', 'selector', 'pixels'], target, clientId);
      break;
    case 'wait_for':
      dispatchToBrowser('wait_for', data, socket, state, ['tabId', 'selector', 'timeout', 'visible'], target, clientId);
      break;
    case 'extract_page':
      dispatchToBrowser('extract_page', data, socket, state, [
        'tabId', 'format', 'includeLinks', 'includeImages',
        'maxContentChars', 'maxLinks', 'maxImages',
      ], target, clientId);
      break;
    case 'upload_file_to_tab':
      dispatchToBrowser('upload_file_to_tab', data, socket, state, ['tabId', 'files', 'targetSelector'], target, clientId);
      break;
    case 'capture_screenshot':
      dispatchToBrowser('capture_screenshot', data, socket, state, ['tabId', 'format', 'quality', 'fullPage'], target, clientId);
      break;
    default:
      send(socket, { type: 'error', requestId, message: `Unknown action: ${action}` });
      break;
  }
}

function dispatchToBrowser(type, data, automationSocket, state, fields, target, clientId = null) {
  const requestId = data.requestId || generateId();
  const ext = pickBrowserClient(state, target);
  if (!ext) {
    const detail = target
      ? `No browser client matching target "${target}"`
      : 'No browser client connected';
    send(automationSocket, {
      type: `${type}_response`,
      requestId,
      status: 'error',
      code: 'BROWSER_UNAVAILABLE',
      message: detail,
    });
    return;
  }

  const operation = BROWSER_OPERATION_BY_WIRE_ACTION[type];
  if (operation && !isOperationSupportedByConnector(operation.id, ext.kind || 'extension')) {
    send(automationSocket, {
      type: `${type}_response`,
      requestId,
      status: 'error',
      code: 'CAPABILITY_UNSUPPORTED',
      message: `Connector ${ext.kind} does not support ${operation.id}`,
    });
    return;
  }

  const msg = { type, requestId };
  for (const field of fields) {
    if (data[field] !== undefined) msg[field] = data[field];
  }

  registerPending(requestId, automationSocket, type, state, clientId);
  try {
    const result = ext.dispatch(msg, state);
    if (result && typeof result.then === 'function') {
      result.catch((err) => {
        resolveRequest(requestId, {
          status: 'error',
          type: 'error',
          message: err.message,
          code: err.code || 'CONNECTOR_ERROR',
          requestId,
        }, state);
      });
    }
  } catch (err) {
    resolveRequest(requestId, {
      status: 'error',
      type: 'error',
      message: err.message,
      code: err.code || 'CONNECTOR_ERROR',
      requestId,
    }, state);
  }
}

function forwardToExtension(type, data, automationSocket, state, fields, target, clientId = null) {
  return dispatchToBrowser(type, data, automationSocket, state, fields, target, clientId);
}

function pickExtension(state, target) {
  return pickBrowserClient(state, target);
}

function requestFromClient(state, client, type, payload = {}) {
  const requestId = generateId();
  return new Promise((resolve, reject) => {
    const fakeSocket = {
      readyState: 1,
      send(raw) {
        try {
          const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (msg.status === 'error') {
            const error = /** @type {Error & { code?: string }} */ (new Error(msg.message || 'connector error'));
            error.code = msg.code || 'CONNECTOR_ERROR';
            reject(error);
            return;
          }
          resolve(msg);
        } catch (error) {
          reject(error);
        }
      },
    };
    registerPending(requestId, fakeSocket, type, state, null);
    try {
      const result = client.dispatch({ type, requestId, ...payload }, state);
      if (result && typeof result.then === 'function') {
        result.catch((err) => {
          resolveRequest(requestId, {
            status: 'error',
            type: 'error',
            message: err.message,
            code: err.code || 'CONNECTOR_ERROR',
            requestId,
          }, state);
        });
      }
    } catch (err) {
      resolveRequest(requestId, {
        status: 'error',
        type: 'error',
        message: err.message,
        code: err.code || 'CONNECTOR_ERROR',
        requestId,
      }, state);
    }
  }).finally(() => {
    state.callbackResponses.delete(requestId);
  });
}

async function handleSyncCookies(data, socket, state, clientId) {
  const requestId = data.requestId || generateId();
  try {
    const result = await syncCookiesBetweenClients(state, {
      domain: data.domain,
      includeSubdomains: data.includeSubdomains,
      source: data.source,
      destination: data.destination,
      overwrite: data.overwrite,
    }, (client, type, payload) => requestFromClient(state, client, type, payload));
    state.audit?.write?.('automation.cookies-sync', {
      clientId,
      domain: result.domain,
      source: result.source,
      destination: result.destination,
      copied: result.copied,
      skipped: result.skipped,
      reasons: result.reasons,
    });
    send(socket, {
      type: 'sync_cookies_response',
      requestId,
      status: 'success',
      ...result,
    });
  } catch (error) {
    send(socket, {
      type: 'sync_cookies_response',
      requestId,
      status: 'error',
      code: error.code || 'CONNECTOR_ERROR',
      message: error.message,
    });
  }
}

function registerPending(requestId, automationSocket, operationType, state, clientId = null) {
  const timeoutMs = state.requestTimeoutMs || REQUEST_TIMEOUT_MS;
  const timeoutId = setTimeout(() => {
    const info = state.pendingResponses.get(requestId);
    if (!info) return;
    state.pendingResponses.delete(requestId);

    const timeoutResponse = {
      status: 'error',
      type: `${operationType}_timeout`,
      requestId,
      message: `Request timed out after ${timeoutMs}ms`,
    };

    send(info.socket, timeoutResponse);
    state.callbackResponses.set(requestId, timeoutResponse);
  }, timeoutMs);

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

    const clients = state.browserClients || state.extensionClients;
    for (const [id, conn] of [...clients.entries()]) {
      if (!isClientOpen(conn)) {
        if (state.browserClients) state.browserClients.delete(id);
        if (conn.kind === 'extension' || conn.socket) state.extensionClients.delete(id);
      }
    }
    for (const [id, conn] of state.automationClients) {
      if (conn.socket.readyState !== 1) state.automationClients.delete(id);
    }
  }, 30000);
}

function createState() {
  const browserClients = new Map();
  return {
    browserClients,
    extensionClients: createExtensionClientsView(browserClients),
    automationClients: new Map(),
    pendingResponses: new Map(),
    callbackResponses: new Map(),
    audit: null,
    serverToken: null,
    security: null,
    pendingEgressDir: null,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    policyGeneration: 1,
    browserConfig: null,
    connectorSupervisor: null,
  };
}

module.exports = {
  handleConnection,
  createState,
  startCleanup,
  getExtensionSummaries,
  getBrowserSummaries,
  REQUEST_TIMEOUT_MS,
  _internal: {
    parseBrowserName,
    pickExtension,
    pickBrowserClient,
    send,
    generateId,
    forwardToExtension,
    dispatchToBrowser,
    handleExtensionMessage,
    handleAutomationMessage,
    requestFromClient,
    setupExtensionClient,
    setupAutomationClient,
    registerPending,
    resolveRequest,
    getOrCreatePolicyForClient,
  },
};
