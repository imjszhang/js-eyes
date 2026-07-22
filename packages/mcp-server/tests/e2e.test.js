'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const WebSocket = require('ws');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createServer } = require('@js-eyes/server-core');
const { DEFAULT_SECURITY_CONFIG } = require('@js-eyes/protocol');

const { createMcpServer } = require('../src/server');

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

async function reservePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

function openFakeExtension(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url}/?type=extension`);
    ws.once('error', reject);
    ws.once('open', () => {
      ws.send(JSON.stringify({
        type: 'init',
        userAgent: 'Mozilla/5.0 Chrome/140.0 Safari/537.36',
      }));
      ws.send(JSON.stringify({
        type: 'data',
        tabs: [{ id: 7, title: 'Example', url: 'https://example.com' }],
        active_tab_id: 7,
      }));
      resolve(ws);
    });
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (!message.requestId) return;
      if (message.type === 'open_url') {
        ws.send(JSON.stringify({
          type: 'open_url_complete',
          requestId: message.requestId,
          tabId: 9,
          url: message.url,
        }));
      } else if (message.type === 'get_html') {
        ws.send(JSON.stringify({
          type: 'tab_html_complete',
          requestId: message.requestId,
          tabId: message.tabId,
          html: '<html><body>real server route</body></html>',
        }));
      } else if (message.type === 'capture_screenshot') {
        ws.send(JSON.stringify({
          type: 'capture_screenshot_complete',
          requestId: message.requestId,
          tabId: message.tabId,
          format: 'png',
          dataUrl: 'data:image/png;base64,YWJj',
          width: 20,
          height: 10,
        }));
      }
    });
  });
}

describe('MCP -> client SDK -> server core -> extension', () => {
  it('routes native MCP calls through the real JS Eyes server', async () => {
    const port = await reservePort();
    const serverCore = createServer({
      host: '127.0.0.1',
      port,
      logger: silentLogger,
      hotReloadConfig: false,
      security: {
        ...DEFAULT_SECURITY_CONFIG,
        allowAnonymous: true,
        enforcement: 'off',
      },
    });
    let extension;
    let mcp;
    let client;
    try {
      await serverCore.start();
      extension = await openFakeExtension(`ws://127.0.0.1:${port}`);

      mcp = createMcpServer({
        serverUrl: `ws://127.0.0.1:${port}`,
        requestTimeout: 5,
        connectTimeout: 5,
        toolProfile: 'safe',
        target: null,
        logLevel: 'silent',
        maxTextChars: 100000,
      }, { logger: silentLogger });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await mcp.server.connect(serverTransport);
      client = new Client({ name: 'e2e-client', version: '1.0.0' });
      await client.connect(clientTransport);

      const tabs = await client.callTool({ name: 'browser_list_tabs', arguments: {} });
      assert.equal(tabs.structuredContent.tabs[0].id, 7);

      const opened = await client.callTool({
        name: 'browser_open_url',
        arguments: { url: 'https://example.com/next' },
      });
      assert.equal(opened.structuredContent.tabId, 9);

      const html = await client.callTool({
        name: 'browser_get_html',
        arguments: { tabId: 7 },
      });
      assert.match(html.content[0].text, /real server route/);

      const screenshot = await client.callTool({
        name: 'browser_take_screenshot',
        arguments: { tabId: 7 },
      });
      assert.equal(screenshot.content[1].type, 'image');
    } finally {
      if (client) await client.close();
      if (mcp) {
        await mcp.session.disconnect();
        await mcp.server.close();
      }
      if (extension) extension.terminate();
      await serverCore.stop();
    }
  });
});
