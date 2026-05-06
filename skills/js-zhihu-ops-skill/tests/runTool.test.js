'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTryOrder, normalizeReadMode } = require('../lib/runTool');

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
