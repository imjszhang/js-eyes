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

  it('requires selector or text for click, and value for fill', () => {
    const click = BROWSER_OPERATION_BY_MCP_TOOL.browser_click;
    assert.deepEqual(click.inputSchema.required, ['tabId']);
    assert.ok(Array.isArray(click.inputSchema.anyOf));
    assert.ok(click.inputSchema.anyOf.some((item) => item.required?.includes('selector')));
    assert.ok(click.inputSchema.anyOf.some((item) => item.required?.includes('text')));

    const fill = BROWSER_OPERATION_BY_MCP_TOOL.browser_fill;
    assert.ok(fill.inputSchema.required.includes('value'));
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
});
