'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const WebSocket = require('ws');

const { createServer } = require('../index');
const {
  getSubprotocolToken,
} = require('../auth');

const TOKEN = 'test-token-abcdefghijklmnopqrstuvwxyz-123456';

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function connectWithProtocols(port, protocols) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/?type=extension`,
      protocols,
      { origin: `http://127.0.0.1:${port}` },
    );
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

async function withServer(run) {
  const port = await reservePort();
  const server = createServer({
    port,
    host: '127.0.0.1',
    token: TOKEN,
    hotReloadConfig: false,
    logger: { info() {}, warn() {}, error() {} },
  });
  await server.start();
  try {
    await run(port);
  } finally {
    await server.stop();
  }
}

describe('WebSocket token subprotocol compatibility', () => {
  it('extracts tokens from the current SDK protocol', () => {
    assert.equal(getSubprotocolToken({
      'sec-websocket-protocol': `jse-token.${TOKEN}`,
    }), TOKEN);
  });

  it('extracts tokens from the published browser-extension protocol', () => {
    assert.equal(getSubprotocolToken({
      'sec-websocket-protocol': `bearer.${TOKEN}, js-eyes`,
    }), TOKEN);
  });

  it('completes a handshake with the current SDK protocol', async () => {
    await withServer(async (port) => {
      const socket = await connectWithProtocols(port, [`jse-token.${TOKEN}`]);
      assert.equal(socket.protocol, `jse-token.${TOKEN}`);
      socket.close();
    });
  });

  it('completes a Chrome-style handshake with the published extension protocols', async () => {
    await withServer(async (port) => {
      const socket = await connectWithProtocols(port, [`bearer.${TOKEN}`, 'js-eyes']);
      assert.equal(socket.protocol, `bearer.${TOKEN}`);
      socket.close();
    });
  });
});
