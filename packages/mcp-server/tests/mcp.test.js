'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const { createMcpServer } = require('../src/server');
const { FacadeError } = require('../src/error-adapter');
const { NativeMcpServer } = require('../src/protocol-server');

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const openInstances = [];

function config(toolProfile = 'safe') {
  return {
    serverUrl: 'ws://localhost:18080',
    requestTimeout: 30,
    connectTimeout: 5,
    toolProfile,
    target: null,
    logLevel: 'silent',
    maxTextChars: 100000,
  };
}

function fakeSession() {
  const calls = [];
  const clients = [{ clientId: 'ext-1', browserName: 'chrome', tabCount: 1 }];
  const bot = {
    async getTabs(options) {
      calls.push(['getTabs', options]);
      return {
        browsers: [{ ...clients[0], tabs: [{ id: 7, title: 'Example', url: 'https://example.com' }] }],
        tabs: [{ id: 7, title: 'Example', url: 'https://example.com' }],
        activeTabId: 7,
      };
    },
    async openUrl(url, tabId, windowId, options) {
      calls.push(['openUrl', url, tabId, windowId, options]);
      return 9;
    },
    async closeTab(id, options) { calls.push(['closeTab', id, options]); },
    async getTabHtml() { return '<html>hello</html>'; },
    async getPageInfo() { return { title: 'Example', url: 'https://example.com' }; },
    async captureScreenshot() {
      return {
        tabId: 7,
        format: 'png',
        dataUrl: 'data:image/png;base64,YWJj',
        segments: [],
        fullPage: false,
      };
    },
    async executeScript() { return 42; },
    async injectCss() {},
    async getCookies() { return [{ name: 'sid', value: 'secret' }]; },
    async getCookiesByDomain() { return []; },
    async uploadFileToTab() { return ['a.txt']; },
  };
  return {
    calls,
    getBot() { return bot; },
    async listClients() { return clients; },
    async resolveTarget() { return 'ext-1'; },
    async operationOptions(_target, extra = {}) { return { ...extra, target: 'ext-1' }; },
    async status() { return { healthy: true, clients }; },
    async disconnect() {},
  };
}

async function connect(toolProfile = 'safe', session = fakeSession()) {
  const instance = createMcpServer(config(toolProfile), { session, logger: silentLogger });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await instance.server.connect(serverTransport);
  const client = new Client({ name: 'js-eyes-mcp-test', version: '1.0.0' });
  await client.connect(clientTransport);
  const connected = { ...instance, client, session };
  openInstances.push(connected);
  return connected;
}

afterEach(async () => {
  while (openInstances.length > 0) {
    const item = openInstances.pop();
    await item.client.close();
    await item.server.close();
  }
});

describe('native MCP protocol', () => {
  it('closes the skill service with the server lifecycle', async () => {
    let disposed = 0;
    let disconnected = 0;
    let serverClosed = 0;
    const instance = createMcpServer(config(), {
      skillService: { async dispose() { disposed += 1; } },
      session: { async disconnect() { disconnected += 1; } },
      server: {
        registerTool() {},
        async close() { serverClosed += 1; },
      },
      logger: silentLogger,
    });
    await instance.close();
    await instance.close();
    assert.deepEqual({ disposed, disconnected, serverClosed }, {
      disposed: 1, disconnected: 1, serverClosed: 1,
    });
  });

  it('exposes only safe tools by default with annotations', async () => {
    const { client } = await connect('safe');
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 11);
    assert.equal(listed.tools.some((tool) => tool.name === 'browser_execute_script'), false);
    const tabs = listed.tools.find((tool) => tool.name === 'browser_list_tabs');
    assert.equal(tabs.annotations.readOnlyHint, true);
  });

  it('exposes sensitive tools only in the full profile', async () => {
    const { client } = await connect('full');
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 16);
    assert.equal(listed.tools.some((tool) => tool.name === 'browser_get_cookies'), true);
  });

  it('calls browser tools and returns structured content', async () => {
    const { client, session } = await connect('safe');
    const result = await client.callTool({
      name: 'browser_open_url',
      arguments: { url: 'https://example.com' },
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.tabId, 9);
    assert.equal(session.calls[0][0], 'openUrl');
    assert.equal(session.calls[0][4].target, 'ext-1');
  });

  it('resolves an explicit list-tabs target to a unique clientId', async () => {
    const session = fakeSession();
    const { client } = await connect('safe', session);
    await client.callTool({
      name: 'browser_list_tabs',
      arguments: { target: 'chrome' },
    });
    assert.equal(session.calls[0][0], 'getTabs');
    assert.equal(session.calls[0][1].target, 'ext-1');
  });

  it('returns screenshots as native MCP image blocks', async () => {
    const { client } = await connect('safe');
    const result = await client.callTool({
      name: 'browser_take_screenshot',
      arguments: { tabId: 7 },
    });
    assert.equal(result.content[1].type, 'image');
    assert.equal(result.content[1].data, 'YWJj');
    assert.equal(result.structuredContent.imageCount, 1);
  });

  it('returns stable tool errors', async () => {
    const session = fakeSession();
    session.operationOptions = async () => {
      throw new FacadeError('JS_EYES_TARGET_REQUIRED', 'Choose a browser.');
    };
    const { client } = await connect('safe', session);
    const result = await client.callTool({
      name: 'browser_close_tab',
      arguments: { tabId: 7 },
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'JS_EYES_TARGET_REQUIRED');
  });

  it('releases its transport after the peer closes first', async () => {
    const server = new NativeMcpServer({ name: 'test', version: '1.0.0' });
    let closeCalls = 0;
    const transport = {
      async start() {},
      async close() { closeCalls += 1; },
    };
    await server.connect(transport);
    transport.onclose();
    await server.close();
    assert.equal(closeCalls, 1);
    assert.equal(server.transport, null);
  });
});
