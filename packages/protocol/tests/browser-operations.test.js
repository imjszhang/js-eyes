'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  BROWSER_OPERATIONS,
  BROWSER_OPERATION_BY_MCP_TOOL,
  BROWSER_OPERATION_BY_OPENCLAW_ACTION,
  assertBrowserOperationsComplete,
  invokeBrowserOperation,
  listBrowserOperationsForProfile,
} = require('../index');

describe('browser operations metadata', () => {
  it('requires schema, description, profiles, and sdkMethod for every operation', () => {
    assert.doesNotThrow(() => assertBrowserOperationsComplete());
  });

  it('keeps stable MCP and OpenClaw names', () => {
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_list_tabs.id, 'tabs.list');
    assert.equal(BROWSER_OPERATION_BY_OPENCLAW_ACTION['browser/get-tabs'].id, 'tabs.list');
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_execute_script.profiles.includes('safe'), false);
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_take_screenshot.profiles.includes('safe'), true);
  });

  it('filters profiles without losing full coverage', () => {
    const safe = listBrowserOperationsForProfile('safe');
    const full = listBrowserOperationsForProfile('full');
    assert.equal(safe.every((op) => op.profiles.includes('safe')), true);
    assert.equal(full.length, BROWSER_OPERATIONS.length);
    assert.equal(safe.some((op) => op.id === 'script.execute'), false);
  });

  it('requires selector, text, or ref for click, and value or secretRef for fill', () => {
    const click = BROWSER_OPERATION_BY_MCP_TOOL.browser_click;
    assert.deepEqual(click.inputSchema.required, ['tabId']);
    assert.ok(Array.isArray(click.inputSchema.anyOf));
    assert.ok(click.inputSchema.anyOf.some((item) => item.required?.includes('selector')));
    assert.ok(click.inputSchema.anyOf.some((item) => item.required?.includes('text')));
    assert.ok(click.inputSchema.anyOf.some((item) => item.required?.includes('ref')));

    const fill = BROWSER_OPERATION_BY_MCP_TOOL.browser_fill;
    assert.ok(fill.inputSchema.anyOf.some((item) => item.required?.includes('value')));
    assert.ok(fill.inputSchema.anyOf.some((item) => item.required?.includes('secretRef')));
    assert.ok(fill.inputSchema.properties.ref);
  });

  it('registers page.state, keys, history, select, dialog, downloads, and waitForUser', () => {
    const state = BROWSER_OPERATION_BY_MCP_TOOL.browser_page_state;
    assert.equal(state.id, 'page.state');
    assert.equal(state.wireAction, 'get_page_state');
    assert.equal(state.capability, 'browser.page.read');
    assert.deepEqual(state.profiles.slice(), ['safe', 'full']);

    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_send_keys.id, 'page.keys');
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_history.id, 'page.history');
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_select.id, 'page.select');
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_handle_dialog.id, 'page.dialog');

    const list = BROWSER_OPERATION_BY_MCP_TOOL.browser_list_downloads;
    assert.equal(list.sensitive, true);
    assert.deepEqual(list.profiles.slice(), ['full']);
    assert.equal(list.capability, 'browser.files.download');

    const waitUser = BROWSER_OPERATION_BY_MCP_TOOL.browser_wait_for_user;
    assert.equal(waitUser.routing, 'server');
    assert.deepEqual(waitUser.profiles.slice(), ['safe', 'full']);
  });

  it('registers cookie write as connector-only and sync as a full-profile server op', () => {
    const write = BROWSER_OPERATIONS.find((operation) => operation.id === 'cookies.write');
    const sync = BROWSER_OPERATION_BY_MCP_TOOL.browser_sync_cookies;
    assert.equal(write.wireAction, 'set_cookies');
    assert.equal(write.sdkMethod, 'setCookies');
    assert.equal(write.mcpTool, undefined);
    assert.equal(write.openclawAction, undefined);
    assert.equal(write.routing, 'extension');
    assert.equal(write.sensitive, true);
    assert.deepEqual(write.profiles.slice(), ['full']);

    assert.equal(sync.id, 'cookies.sync');
    assert.equal(sync.wireAction, 'sync_cookies');
    assert.equal(sync.routing, 'server');
    assert.equal(sync.openclawAction, 'browser/sync-cookies');
    assert.deepEqual(sync.capabilities.slice(), ['browser.cookies.read', 'browser.cookies.write']);
    assert.deepEqual(sync.inputSchema.required.slice(), ['domain', 'source', 'destination']);
    assert.equal(listBrowserOperationsForProfile('safe').some((op) => op.id === 'cookies.sync'), false);
  });

  it('registers declarative page.extract as a safe read operation', () => {
    const extract = BROWSER_OPERATION_BY_MCP_TOOL.browser_extract_page;
    assert.equal(extract.id, 'page.extract');
    assert.equal(extract.wireAction, 'extract_page');
    assert.equal(extract.sdkMethod, 'extractPage');
    assert.equal(extract.risk, 'read');
    assert.deepEqual(extract.profiles.slice(), ['safe', 'full']);
    assert.equal(extract.sensitive, undefined);
    assert.ok(extract.inputSchema.required.includes('tabId'));
  });

  it('registers drag, wheel, selectText, zoom, and recording operations', () => {
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_drag.id, 'page.drag');
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_wheel.id, 'page.wheel');
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_select_text.id, 'page.selectText');
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_zoom.id, 'tab.zoom');
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_record_start.id, 'recording.start');
    assert.equal(BROWSER_OPERATION_BY_MCP_TOOL.browser_record_stop.id, 'recording.stop');
    assert.equal(BROWSER_OPERATION_BY_OPENCLAW_ACTION['browser/drag'].id, 'page.drag');
    assert.equal(BROWSER_OPERATION_BY_OPENCLAW_ACTION['browser/record-start'].id, 'recording.start');
    assert.equal(BROWSER_OPERATION_BY_OPENCLAW_ACTION['browser/record-stop'].id, 'recording.stop');
  });
});

describe('invokeBrowserOperation', () => {
  it('routes args through sdkMethod signatures', async () => {
    const calls = [];
    const browser = {
      async openUrl(url, tabId, windowId, options) {
        calls.push(['openUrl', url, tabId, windowId, options]);
        return 3;
      },
      async getTabs(options) {
        calls.push(['getTabs', options]);
        return { tabs: [] };
      },
    };
    const tabId = await invokeBrowserOperation(browser, 'url.open', {
      url: 'https://example.com',
      tabId: 1,
    }, { target: 'ext-1' });
    assert.equal(tabId, 3);
    assert.deepEqual(calls[0], [
      'openUrl',
      'https://example.com',
      1,
      null,
      { target: 'ext-1' },
    ]);

    await invokeBrowserOperation(browser, 'browser_list_tabs', {}, { timeout: 9 });
    assert.deepEqual(calls[1], ['getTabs', { timeout: 9 }]);
  });

  it('buffers transport timeout above page.waitFor wait seconds', async () => {
    const calls = [];
    const browser = {
      async waitFor(tabId, params, options) {
        calls.push([tabId, params, options]);
        return { success: true };
      },
    };
    await invokeBrowserOperation(browser, 'page.waitFor', {
      tabId: 7,
      selector: '#ready',
      timeout: 10,
    }, { timeout: 10, target: 'ext-1' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].timeout, 10);
    assert.equal(calls[0][2].timeout, 15);
    assert.equal(calls[0][2].target, 'ext-1');
  });

  it('routes cookies.sync through resolved source and destination', async () => {
    const calls = [];
    const browser = {
      async syncCookies(params, options) {
        calls.push([params, options]);
        return { domain: params.domain, copied: 1, skipped: 0, reasons: [] };
      },
    };
    const result = await invokeBrowserOperation(browser, 'cookies.sync', {
      domain: 'x.com',
      source: 'chrome',
      destination: 'cdp',
    }, { source: 'src-1', destination: 'dst-1' });
    assert.equal(result.copied, 1);
    assert.equal(calls[0][0].source, 'src-1');
    assert.equal(calls[0][0].destination, 'dst-1');
  });

  it('routes page.extract through extractPage', async () => {
    const calls = [];
    const browser = {
      async extractPage(tabId, params, options) {
        calls.push([tabId, params, options]);
        return { status: 'ok', content: 'hello' };
      },
    };
    const result = await invokeBrowserOperation(browser, 'page.extract', {
      tabId: 9,
      format: 'markdown',
      maxContentChars: 4000,
    }, { target: 'ext-1' });
    assert.equal(result.status, 'ok');
    assert.equal(calls[0][0], 9);
    assert.equal(calls[0][1].format, 'markdown');
    assert.equal(calls[0][1].maxContentChars, 4000);
    assert.equal(calls[0][2].target, 'ext-1');
  });

  it('routes page.state and waitForUser', async () => {
    const calls = [];
    const browser = {
      async getPageState(tabId, params, options) {
        calls.push(['state', tabId, params, options]);
        return { generation: 1, elements: [] };
      },
      async waitForUser(params, options) {
        calls.push(['waitUser', params, options]);
        return { status: 'resumed', pendingId: 'u1' };
      },
    };
    const state = await invokeBrowserOperation(browser, 'page.state', {
      tabId: 3,
      maxElements: 20,
    }, { target: 'ext-1' });
    assert.equal(state.generation, 1);
    assert.equal(calls[0][1], 3);
    assert.equal(calls[0][2].maxElements, 20);

    const waited = await invokeBrowserOperation(browser, 'page.waitForUser', {
      reason: 'login',
      timeout: 30,
    });
    assert.equal(waited.status, 'resumed');
    assert.equal(calls[1][1].reason, 'login');
    assert.equal(calls[1][2].timeout, 35);
  });

  it('routes drag, wheel, selectText, zoom, and recording operations', async () => {
    const calls = [];
    const browser = {
      async drag(tabId, params, options) { calls.push(['drag', tabId, params, options]); return { success: true }; },
      async wheel(tabId, params, options) { calls.push(['wheel', tabId, params, options]); return { success: true }; },
      async selectText(tabId, params, options) { calls.push(['selectText', tabId, params, options]); return { success: true, text: 'hi' }; },
      async setZoom(tabId, params, options) { calls.push(['setZoom', tabId, params, options]); return { success: true, zoomFactor: 1.5 }; },
      async startRecording(tabId, params, options) { calls.push(['startRecording', tabId, params, options]); return { recordingId: 'rec_1' }; },
      async stopRecording(tabId, params, options) { calls.push(['stopRecording', tabId, params, options]); return { recordingId: 'rec_1', frameCount: 2 }; },
    };
    await invokeBrowserOperation(browser, 'page.drag', { tabId: 4, fromX: 10, fromY: 20, deltaX: 50, deltaY: 0 }, { target: 'ext-1' });
    await invokeBrowserOperation(browser, 'page.wheel', { tabId: 4, deltaY: 200, steps: 4 }, { target: 'ext-1' });
    await invokeBrowserOperation(browser, 'page.selectText', { tabId: 4, text: 'hello' }, { target: 'ext-1' });
    await invokeBrowserOperation(browser, 'tab.zoom', { tabId: 4, zoomFactor: 1.5 }, { target: 'ext-1' });
    await invokeBrowserOperation(browser, 'recording.start', { tabId: 4, fps: 2, activate: true }, { target: 'ext-1' });
    await invokeBrowserOperation(browser, 'recording.stop', { tabId: 4, recordingId: 'rec_1' }, { target: 'ext-1' });

    assert.equal(calls.length, 6);
    assert.equal(calls[0][0], 'drag');
    assert.equal(calls[0][2].deltaX, 50);
    assert.equal(calls[1][0], 'wheel');
    assert.equal(calls[1][2].deltaY, 200);
    assert.equal(calls[2][0], 'selectText');
    assert.equal(calls[2][2].text, 'hello');
    assert.equal(calls[3][0], 'setZoom');
    assert.equal(calls[3][2].zoomFactor, 1.5);
    assert.equal(calls[4][0], 'startRecording');
    assert.equal(calls[4][2].activate, true);
    assert.equal(calls[5][0], 'stopRecording');
    assert.equal(calls[5][2].recordingId, 'rec_1');
  });
});
