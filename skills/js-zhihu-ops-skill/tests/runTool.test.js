'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTryOrder, normalizeReadMode, classifyRunBlocker, classifyAntiCrawl } = require('../lib/runTool');

test('normalizeReadMode defaults to auto and accepts dom/api', () => {
  assert.equal(normalizeReadMode(), 'auto');
  assert.equal(normalizeReadMode('dom'), 'dom');
  assert.equal(normalizeReadMode('api'), 'api');
  assert.equal(normalizeReadMode('bad'), 'auto');
});

test('buildTryOrder prefers DOM for zhihu read tools', () => {
  const def = { methodBase: 'getAnswer', domSupported: true, apiSupported: false };
  assert.deepEqual(buildTryOrder('getAnswer', 'dom', def), ['dom_getAnswer', 'getAnswer']);
  assert.deepEqual(buildTryOrder('getAnswer', 'auto', def), ['dom_getAnswer', 'getAnswer']);
});

test('buildTryOrder keeps legacy methods untouched', () => {
  assert.deepEqual(buildTryOrder('sessionState', 'auto', { legacyOnly: true }), ['sessionState']);
});

test('classifyRunBlocker maps common response codes', () => {
  assert.deepEqual(classifyRunBlocker({ error: 'captcha_required' }), {
    category: 'captcha',
    recommendedAction: 'pause_and_verify',
  });
  assert.deepEqual(classifyRunBlocker({ error: 'dom_navigation_required' }), {
    category: 'navigation',
    recommendedAction: 'navigate_then_retry',
  });
});

test('classifyAntiCrawl returns structured category and action', () => {
  assert.deepEqual(classifyAntiCrawl({ error: 'login_required' }), {
    paused: false,
    reason: 'login_required',
    category: 'auth',
    recommendedAction: 'reauth',
  });
  assert.deepEqual(classifyAntiCrawl({ error: 'dom_not_found' }), {
    paused: false,
    reason: 'dom_not_found',
    category: 'dom',
    recommendedAction: 'retry_or_fallback',
  });
});
