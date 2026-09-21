'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  createState,
  _internal: { handleAutomationMessage, resolveRequest },
} = require('../ws-handler');
const { listOperationIdsForConnector } = require('@js-eyes/protocol');
const { classifyCookies } = require('../connectors/cookie-record');

function createMockSocket() {
  const messages = [];
  return {
    readyState: 1,
    send(data) { messages.push(JSON.parse(data)); },
    on() {},
    close() { this.readyState = 3; },
    _messages: messages,
  };
}

async function waitForMessage(socket, requestId, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = socket._messages.find((item) => item.requestId === requestId);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${requestId}`);
}

function fakeClient(state, { clientId, kind, browserName, store }) {
  const record = {
    clientId,
    kind,
    browserName,
    createdAt: Date.now(),
    tabs: [],
    isOpen: () => true,
    capabilities: listOperationIdsForConnector(kind),
    dispatch(message) {
      if (message.type === 'get_cookies_by_domain') {
        resolveRequest(message.requestId, {
          status: 'success',
          type: 'get_cookies_by_domain_complete',
          domain: message.domain,
          cookies: store.slice(),
          total: store.length,
          requestId: message.requestId,
        }, state);
        return;
      }
      if (message.type === 'set_cookies') {
        for (const cookie of message.cookies || []) store.push(cookie);
        resolveRequest(message.requestId, {
          status: 'success',
          type: 'set_cookies_complete',
          set: (message.cookies || []).length,
          skipped: 0,
          reasons: [],
          requestId: message.requestId,
        }, state);
      }
    },
  };
  state.browserClients.set(clientId, record);
  return record;
}

describe('cookie record classification', () => {
  it('skips CHIPS, expired, and host-prefix mismatches', () => {
    const classified = classifyCookies([
      { name: 'ok', value: '1', domain: 'example.com', path: '/' },
      { name: 'part', value: '1', domain: 'example.com', partitionKey: { topLevelSite: 'https://a.com' } },
      { name: '__Host-a', value: '1', domain: '.example.com', path: '/', secure: true },
      { name: 'old', value: '1', domain: 'example.com', expires: 1 },
    ]);
    assert.equal(classified.cookies.length, 1);
    assert.equal(classified.cookies[0].name, 'ok');
    assert.deepEqual(classified.reasons.map((item) => item.reason).sort(), [
      'chips-partition',
      'expired',
      'host-prefix',
    ]);
  });
});

describe('cookies.sync memory transfer', () => {
  let state;
  let auto;

  beforeEach(() => {
    state = createState();
    state.security = { enforcement: 'off' };
    auto = createMockSocket();
    state.automationClients.set('auto', { socket: auto, anonymous: false });
  });

  it('copies cookies in memory and never returns values', async () => {
    const sourceStore = [{ name: 'sid', value: 'secret-session', domain: 'x.com', path: '/' }];
    const destStore = [];
    fakeClient(state, { clientId: 'src-1', kind: 'extension', browserName: 'chrome', store: sourceStore });
    fakeClient(state, { clientId: 'dst-1', kind: 'cdp', browserName: 'cdp', store: destStore });

    await handleAutomationMessage(
      JSON.stringify({
        action: 'sync_cookies',
        requestId: 'sync-1',
        domain: 'x.com',
        source: 'src-1',
        destination: 'dst-1',
      }),
      'auto',
      auto,
      state,
    );
    const response = await waitForMessage(auto, 'sync-1');
    assert.equal(response.status, 'success');
    assert.equal(response.copied, 1);
    assert.equal(response.skipped, 0);
    assert.equal(destStore[0].value, 'secret-session');
    assert.equal(JSON.stringify(response).includes('secret-session'), false);
    assert.equal(response.cookies, undefined);
  });

  it('fails when the destination connector cannot write cookies', async () => {
    fakeClient(state, { clientId: 'src-1', kind: 'extension', browserName: 'chrome', store: [] });
    state.browserClients.set('dst-bad', {
      clientId: 'dst-bad',
      kind: 'unknown',
      browserName: 'other',
      createdAt: Date.now(),
      tabs: [],
      isOpen: () => true,
      capabilities: [],
      dispatch() {},
    });

    await handleAutomationMessage(
      JSON.stringify({
        action: 'sync_cookies',
        requestId: 'sync-2',
        domain: 'x.com',
        source: 'src-1',
        destination: 'dst-bad',
      }),
      'auto',
      auto,
      state,
    );
    const response = await waitForMessage(auto, 'sync-2');
    assert.equal(response.status, 'error');
    assert.equal(response.code, 'CAPABILITY_UNSUPPORTED');
  });
});
