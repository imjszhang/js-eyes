'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketServer } = require('ws');
const {
  createState,
  getBrowserSummaries,
  _internal: { handleAutomationMessage },
} = require('../ws-handler');
const { createCdpConnector } = require('../connectors/cdp');
const { createBidiConnector } = require('../connectors/bidi');
const { assertLoopbackEndpoint } = require('../connectors/loopback');
const { mergeBrowserConfig } = require('@js-eyes/config');
const { FORWARDABLE_ACTIONS } = require('@js-eyes/protocol');

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

function listenFakeServer(onMessage) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        const result = onMessage(msg) ?? {};
        ws.send(JSON.stringify({ id: msg.id, result }));
      });
    });
    wss.on('listening', () => {
      const { port } = wss.address();
      resolve({
        wss,
        port,
        wsUrl: `ws://127.0.0.1:${port}`,
        close: () => new Promise((done) => wss.close(done)),
      });
    });
  });
}

describe('browser config', () => {
  it('defaults CDP and BiDi to disabled', () => {
    const browser = mergeBrowserConfig();
    assert.equal(browser.defaultTransport, 'extension');
    assert.equal(browser.transports.cdp.enabled, false);
    assert.equal(browser.transports.bidi.enabled, false);
    assert.equal(browser.transports.extension.enabled, true);
  });

  it('rejects non-loopback endpoints unless allowRemoteBind is set', () => {
    assert.throws(
      () => assertLoopbackEndpoint('http://8.8.8.8:9222', { loopbackOnly: true, label: 'cdp' }),
      /loopback/,
    );
    assert.throws(
      () => assertLoopbackEndpoint('http://8.8.8.8:9222', { loopbackOnly: false, allowRemoteBind: false, label: 'cdp' }),
      /allowRemoteBind/,
    );
    assertLoopbackEndpoint('http://127.0.0.1:9222', { loopbackOnly: true, label: 'cdp' });
  });
});

describe('CDP connector', () => {
  let fake;
  let state;
  let connector;
  const cdpCalls = [];

  before(async () => {
    fake = await listenFakeServer((msg) => {
      cdpCalls.push(msg);
      switch (msg.method) {
        case 'Target.getTargets':
          return {
            targetInfos: [{
              targetId: 't1', type: 'page', url: 'https://example.com', title: 'Example',
            }],
          };
        case 'Target.attachToTarget':
          return { sessionId: 's1' };
        case 'Target.createTarget':
          return { targetId: 't-new' };
        case 'Target.closeTarget':
          return { success: true };
        case 'Page.navigate':
        case 'Target.setDiscoverTargets':
        case 'Target.setAutoAttach':
        case 'Runtime.runIfWaitingForDebugger':
        case 'DOM.setFileInputFiles':
          return {};
        case 'Page.captureScreenshot':
          return { data: 'AAAA' };
        case 'Network.getAllCookies':
        case 'Network.getCookies':
        case 'Storage.getCookies':
          return { cookies: [{ name: 'sid', value: '1', domain: 'example.com' }] };
        case 'Network.setCookie':
        case 'Network.deleteCookies':
        case 'Storage.setCookies':
          return { success: true };
        case 'DOM.getDocument':
          return { root: { nodeId: 1 } };
        case 'DOM.querySelector':
          return { nodeId: 2 };
        case 'Runtime.evaluate':
          if (String(msg.params?.expression || '').includes('outerHTML')) {
            return { result: { value: '<html><body>hi</body></html>' } };
          }
          if (String(msg.params?.expression || '').includes('eval')) {
            return { result: { value: 7 } };
          }
          return { result: { value: { success: true } } };
        default:
          return {};
      }
    });
    state = createState();
    state.security = { allowRawEval: true, allowRemoteBind: false, enforcement: 'off' };
    connector = createCdpConnector({
      config: {
        enabled: true,
        mode: 'endpoint',
        endpoint: fake.wsUrl,
        loopbackOnly: true,
        channel: 'chrome',
      },
      security: state.security,
      state,
      logger: { warn() {}, info() {} },
    });
    await connector.start();
  });

  after(async () => {
    if (connector) await connector.stop();
    if (fake) await fake.close();
  });

  it('registers a cdp client and serves first-class actions', async () => {
    const summaries = getBrowserSummaries(state);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].kind, 'cdp');
    assert.ok(summaries[0].capabilities.includes('url.open'));

    const auto = createMockSocket();
    state.automationClients.set('auto', { socket: auto, anonymous: false });
    await handleAutomationMessage(
      JSON.stringify({ action: 'get_html', tabId: 1, requestId: 'html-1' }),
      'auto',
      auto,
      state,
    );
    const response = await waitForMessage(auto, 'html-1');
    assert.equal(response.status, 'success');
    assert.equal(response.html, '<html><body>hi</body></html>');
  });

  it('maps every forwardable wire action', async () => {
    const payloads = {
      open_url: { url: 'https://example.com' },
      close_tab: { tabId: 1 },
      get_html: { tabId: 1 },
      execute_script: { tabId: 1, code: '1+1' },
      inject_css: { tabId: 1, css: 'body{}' },
      get_cookies: { tabId: 1 },
      get_cookies_by_domain: { domain: 'example.com' },
      set_cookies: { cookies: [{ name: 'sid', value: '1', domain: 'example.com', path: '/' }] },
      get_page_info: { tabId: 1 },
      click: { tabId: 1, selector: 'a' },
      fill: { tabId: 1, selector: 'input', value: 'x' },
      scroll: { tabId: 1 },
      wait_for: { tabId: 1, selector: 'body' },
      extract_page: { tabId: 1, format: 'text' },
      upload_file_to_tab: {
        tabId: 1,
        files: [{ name: 'a.txt', base64: Buffer.from('hi').toString('base64') }],
      },
      capture_screenshot: { tabId: 1 },
    };
    for (const action of FORWARDABLE_ACTIONS) {
      assert.ok(payloads[action], `missing fixture for ${action}`);
      const auto = createMockSocket();
      const requestId = `all-${action}`;
      state.automationClients.set(`auto-${action}`, { socket: auto, anonymous: false });
      await handleAutomationMessage(
        JSON.stringify({ action, requestId, ...payloads[action] }),
        `auto-${action}`,
        auto,
        state,
      );
      const response = await waitForMessage(auto, requestId);
      assert.equal(response.status, 'success', `${action}: ${response.message || ''}`);
    }
  });

  it('blocks raw eval when allowRawEval is false', async () => {
    state.security.allowRawEval = false;
    const auto = createMockSocket();
    state.automationClients.set('auto-2', { socket: auto, anonymous: false });
    await handleAutomationMessage(
      JSON.stringify({ action: 'execute_script', tabId: 1, code: '1+1', requestId: 'eval-1' }),
      'auto-2',
      auto,
      state,
    );
    const response = await waitForMessage(auto, 'eval-1');
    assert.equal(response.status, 'error');
    assert.equal(response.code, 'RAW_EVAL_DISABLED');
    state.security.allowRawEval = true;
  });

  it('writes cookies through Network.setCookie and omits values from the response', async () => {
    const set = cdpCalls.find((msg) => msg.method === 'Storage.setCookies')
      || cdpCalls.find((msg) => msg.method === 'Network.setCookie');
    assert.ok(set);
    const cookie = set.method === 'Storage.setCookies' ? set.params.cookies[0] : set.params;
    assert.equal(cookie.name, 'sid');
    assert.equal(cookie.value, '1');
    const auto = createMockSocket();
    state.automationClients.set('auto-set', { socket: auto, anonymous: false });
    await handleAutomationMessage(
      JSON.stringify({
        action: 'set_cookies',
        requestId: 'set-1',
        cookies: [{ name: 'sid', value: 'secret-value', domain: 'example.com', path: '/' }],
      }),
      'auto-set',
      auto,
      state,
    );
    const response = await waitForMessage(auto, 'set-1');
    assert.equal(response.status, 'success');
    assert.equal(JSON.stringify(response).includes('secret-value'), false);
    assert.ok(response.set >= 1);
  });
});

describe('BiDi connector', () => {
  let fake;
  let state;
  let connector;
  const bidiCalls = [];

  before(async () => {
    fake = await listenFakeServer((msg) => {
      bidiCalls.push(msg);
      switch (msg.method) {
        case 'session.new':
        case 'session.subscribe':
        case 'session.end':
        case 'browsingContext.navigate':
        case 'browsingContext.close':
        case 'input.setFiles':
          return {};
        case 'browsingContext.getTree':
          return { contexts: [{ context: 'c1', url: 'https://example.com' }] };
        case 'browsingContext.create':
          return { context: 'c2' };
        case 'browsingContext.captureScreenshot':
          return { data: 'BBBB' };
        case 'storage.getCookies':
          return { cookies: [{ name: 'a', domain: 'example.com' }] };
        case 'storage.setCookie':
        case 'storage.deleteCookies':
          return {};
        case 'script.evaluate':
          return {
            result: {
              type: 'object',
              value: [
                ['success', { type: 'boolean', value: true }],
                ['url', { type: 'string', value: 'https://example.com' }],
              ],
            },
          };
        default:
          return {};
      }
    });
    state = createState();
    state.security = { allowRawEval: false, allowRemoteBind: false, enforcement: 'off' };
    connector = createBidiConnector({
      config: { enabled: true, endpoint: fake.wsUrl, loopbackOnly: true },
      security: state.security,
      state,
      logger: { warn() {}, info() {} },
    });
    await connector.start();
  });

  after(async () => {
    if (connector) await connector.stop();
    if (fake) await fake.close();
  });

  it('registers a firefox bidi client', () => {
    const summaries = getBrowserSummaries(state);
    assert.equal(summaries[0].kind, 'bidi');
    assert.equal(summaries[0].browserName, 'firefox');
  });

  it('opens a url through BiDi', async () => {
    const auto = createMockSocket();
    state.automationClients.set('auto-bidi', { socket: auto, anonymous: false });
    await handleAutomationMessage(
      JSON.stringify({ action: 'open_url', url: 'https://example.org', requestId: 'open-1' }),
      'auto-bidi',
      auto,
      state,
    );
    const response = await waitForMessage(auto, 'open-1');
    assert.equal(response.status, 'success');
    assert.ok(response.tabId >= 1);
  });

  it('writes cookies through storage.setCookie', async () => {
    const auto = createMockSocket();
    state.automationClients.set('auto-bidi-set', { socket: auto, anonymous: false });
    await handleAutomationMessage(
      JSON.stringify({
        action: 'set_cookies',
        requestId: 'bidi-set-1',
        cookies: [{ name: 'sid', value: 'secret-bidi', domain: 'example.com', path: '/' }],
      }),
      'auto-bidi-set',
      auto,
      state,
    );
    const response = await waitForMessage(auto, 'bidi-set-1');
    assert.equal(response.status, 'success');
    assert.equal(JSON.stringify(response).includes('secret-bidi'), false);
    const set = bidiCalls.find((msg) => msg.method === 'storage.setCookie');
    assert.ok(set);
    assert.equal(set.params.cookie.name, 'sid');
  });
});
