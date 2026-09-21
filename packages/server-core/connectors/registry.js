'use strict';

const { listOperationIdsForConnector } = require('@js-eyes/protocol');

function isClientOpen(conn) {
  if (!conn) return false;
  if (typeof conn.isOpen === 'function') return conn.isOpen();
  return !!(conn.socket && conn.socket.readyState === 1);
}

function hydrateExtensionRecord(clientId, conn) {
  if (!conn || typeof conn !== 'object') return conn;
  conn.clientId = conn.clientId || clientId;
  conn.kind = conn.kind || 'extension';
  conn.transport = conn.transport || 'extension';
  if (!Array.isArray(conn.capabilities)) {
    conn.capabilities = listOperationIdsForConnector('extension');
  }
  if (typeof conn.isOpen !== 'function') {
    conn.isOpen = () => !!(conn.socket && conn.socket.readyState === 1);
  }
  if (typeof conn.dispatch !== 'function') {
    conn.dispatch = (msg) => {
      if (conn.socket && conn.socket.readyState === 1) {
        conn.socket.send(JSON.stringify(msg));
      }
    };
  }
  if (typeof conn.dispose !== 'function') {
    conn.dispose = () => {
      try { conn.socket?.close(); } catch { /* ignore */ }
    };
  }
  return conn;
}

function createExtensionClientsView(browserClients) {
  const view = new Map();
  const origSet = Map.prototype.set.bind(view);
  const origDelete = Map.prototype.delete.bind(view);
  const origClear = Map.prototype.clear.bind(view);

  view.set = (id, conn) => {
    const record = hydrateExtensionRecord(id, conn);
    browserClients.set(id, record);
    return origSet(id, record);
  };
  view.delete = (id) => {
    const existing = browserClients.get(id);
    if (!existing || existing.kind === 'extension') {
      browserClients.delete(id);
    }
    return origDelete(id);
  };
  view.clear = () => {
    for (const [id, conn] of [...browserClients.entries()]) {
      if (conn.kind === 'extension') browserClients.delete(id);
    }
    return origClear();
  };
  return view;
}

function getBrowserSummaries(state) {
  const clients = state.browserClients || state.extensionClients;
  const summaries = [];
  for (const [clientId, conn] of clients) {
    if (!isClientOpen(conn)) continue;
    const tabs = Array.isArray(conn.tabs) ? conn.tabs : [];
    summaries.push({
      clientId: conn.clientId || clientId,
      browserName: conn.browserName,
      kind: conn.kind || 'extension',
      transport: conn.transport || conn.kind || 'extension',
      capabilities: Array.isArray(conn.capabilities) ? conn.capabilities.slice() : [],
      tabs,
      activeTabId: conn.activeTabId,
      tabCount: tabs.length,
      connectedAt: new Date(conn.createdAt || Date.now()).toISOString(),
    });
  }
  return summaries;
}

function getClientId(state, conn) {
  if (!conn) return null;
  if (conn.clientId) return conn.clientId;
  const clients = state.browserClients || state.extensionClients;
  for (const [id, candidate] of clients) {
    if (candidate === conn) return id;
  }
  return null;
}

function pickBrowserClient(state, target) {
  const clients = state.browserClients || state.extensionClients;
  if (!target) {
    for (const [, conn] of clients) {
      if (isClientOpen(conn)) return conn;
    }
    return null;
  }

  const unique = pickUniqueBrowserClient(state, target);
  return unique.client || null;
}

function pickUniqueBrowserClient(state, target) {
  const clients = state.browserClients || state.extensionClients;
  if (!target) {
    return { client: null, error: 'TARGET_REQUIRED', message: 'Browser clientId or unique browser name is required' };
  }

  const byId = clients.get(target);
  if (byId && isClientOpen(byId)) return { client: byId };

  const lower = String(target).toLowerCase();
  const named = [];
  for (const [, conn] of clients) {
    if (isClientOpen(conn) && String(conn.browserName || '').toLowerCase() === lower) {
      named.push(conn);
    }
  }
  if (named.length === 1) return { client: named[0] };
  if (named.length > 1) {
    return {
      client: null,
      error: 'TARGET_REQUIRED',
      message: `Browser target "${target}" matches multiple connected clients; use a clientId.`,
    };
  }
  return {
    client: null,
    error: 'BROWSER_UNAVAILABLE',
    message: `No browser client matching target "${target}"`,
  };
}

function registerBrowserClient(state, clientId, record) {
  const next = {
    ...record,
    clientId,
    capabilities: Array.isArray(record.capabilities)
      ? record.capabilities
      : listOperationIdsForConnector(record.kind || 'extension'),
  };
  state.browserClients.set(clientId, next);
  return next;
}

function unregisterBrowserClient(state, clientId) {
  const existing = state.browserClients.get(clientId);
  state.browserClients.delete(clientId);
  if (existing && existing.kind === 'extension') {
    state.extensionClients.delete(clientId);
  }
  return existing || null;
}

module.exports = {
  createExtensionClientsView,
  getBrowserSummaries,
  getClientId,
  hydrateExtensionRecord,
  isClientOpen,
  pickBrowserClient,
  pickUniqueBrowserClient,
  registerBrowserClient,
  unregisterBrowserClient,
};
