'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const WebSocket = require('ws');
const { createServer } = require('../../server-core/index');
const { BrowserAutomation } = require('@js-eyes/client-sdk');

const token = 'queue-test-authentication-0123456789';
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

test('authenticated SDK/server recovery roundtrip and legacy capability refusal', { timeout: 15000 }, async (t) => {
  const reserve = net.createServer();
  await new Promise((r) => reserve.listen(0, '127.0.0.1', r));
  const port = reserve.address().port;
  await new Promise((r) => reserve.close(r));

  const server = createServer({ host: '127.0.0.1', port, token, hotReloadConfig: false, logger: quiet });
  await server.start();

  const ext = new WebSocket(`ws://127.0.0.1:${port}/?type=extension`, [`jse-token.${token}`], {
    origin: `http://127.0.0.1:${port}`,
  });

  // Minimal protocol mock for an extension implementing browser.queue.manage
  const activeRequests = new Map();
  for (let i = 0; i < 100; i++) {
    activeRequests.set(`old-${i}`, { action: 'list_downloads', expired: false });
  }
  let extId;
  ext.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'auth_result') {
      extId = m.clientId;
      ext.send(JSON.stringify({ type: 'init', userAgent: 'Firefox/150', capabilities: ['browser.queue.manage'] }));
    } else if (m.type === 'queue_status') {
      ext.send(JSON.stringify({
        type: 'queue_control_complete',
        requestId: m.requestId,
        result: { size: activeRequests.size, maxSize: 100, timeoutMs: 60000, cleared: 0, requests: [] },
      }));
    } else if (m.type === 'queue_clear') {
      let cleared = 0;
      if (m.all) {
        cleared = activeRequests.size;
        activeRequests.clear();
      }
      ext.send(JSON.stringify({
        type: 'queue_control_complete',
        requestId: m.requestId,
        result: { size: activeRequests.size, maxSize: 100, timeoutMs: 60000, cleared, requests: [] },
      }));
    }
  });

  const client = new BrowserAutomation(`ws://127.0.0.1:${port}`, { token, logger: quiet, defaultTimeout: 2 });
  t.after(async () => {
    client.disconnect();
    ext.close();
    await server.stop();
  });
  await client.connect();

  for (let i = 0; i < 30; i++) {
    if ((await client.listClients()).some((c) => c.capabilities?.includes('queue.status'))) break;
    await new Promise((r) => setTimeout(r, 10));
  }

  const opts = { target: extId };
  assert.equal((await client.getQueueStatus(opts)).size, 100);
  assert.equal((await client.clearQueue({}, opts)).cleared, 0);
  assert.equal((await client.clearQueue({ all: true }, opts)).cleared, 100);
  assert.equal((await client.getQueueStatus(opts)).size, 0);

  ext.send(JSON.stringify({ type: 'init', userAgent: 'Firefox/150', capabilities: [] }));
  for (let i = 0; i < 30; i++) {
    if (!(await client.listClients()).some((c) => c.capabilities?.includes('queue.status'))) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  await assert.rejects(client.getQueueStatus(opts), { code: 'CAPABILITY_UNSUPPORTED' });
});

test('queue recovery rejects anonymous callers even when anonymous connections are enabled', async () => {
  const { createState, _internal: { handleAutomationMessage } } = require('../../server-core/ws-handler');
  const state = createState();
  const messages = [];
  const socket = { readyState: 1, send: (s) => messages.push(JSON.parse(s)) };
  state.automationClients.set('anon', { socket, anonymous: true });
  for (const action of ['queue_status', 'queue_clear']) {
    await handleAutomationMessage(JSON.stringify({ action, requestId: action, all: true }), 'anon', socket, state);
    assert.equal(messages.at(-1).code, 'AUTH_REQUIRED');
  }
  assert.equal(state.pendingResponses.size, 0);
});
