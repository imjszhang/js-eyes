'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTryOrder, normalizeReadMode, FALLBACK_ERRORS } = require('../lib/runTool');

test('normalizeReadMode 默认 auto，识别 dom/api/graphql', () => {
  assert.equal(normalizeReadMode(), 'auto');
  assert.equal(normalizeReadMode(''), 'auto');
  assert.equal(normalizeReadMode('AUTO'), 'auto');
  assert.equal(normalizeReadMode('dom'), 'dom');
  assert.equal(normalizeReadMode('api'), 'api');
  assert.equal(normalizeReadMode('graphql'), 'api');
});

test('buildTryOrder auto 模式 = DOM 优先 → API 兜底（与 X 取反）', () => {
  const cmdDef = { methodBase: 'getNote', domSupported: true, apiSupported: true };
  const order = buildTryOrder('getNote', 'auto', cmdDef);
  assert.deepEqual(order, ['dom_getNote', 'api_getNote']);
});

test('buildTryOrder dom 模式只跑 dom_*', () => {
  const cmdDef = { methodBase: 'getNote', domSupported: true, apiSupported: true };
  assert.deepEqual(buildTryOrder('getNote', 'dom', cmdDef), ['dom_getNote']);
});

test('buildTryOrder api 模式优先 api_* + base 兜底', () => {
  const cmdDef = { methodBase: 'getComments', domSupported: false, apiSupported: true };
  assert.deepEqual(buildTryOrder('getComments', 'api', cmdDef), ['api_getComments', 'getComments']);
});

test('buildTryOrder legacyOnly 直接返回 method', () => {
  const cmdDef = { legacyOnly: true };
  assert.deepEqual(buildTryOrder('sessionState', 'auto', cmdDef), ['sessionState']);
});

test('FALLBACK_ERRORS 包含 dom 不稳定码与 risk_check_required', () => {
  assert.ok(FALLBACK_ERRORS.has('dom_unstable'));
  assert.ok(FALLBACK_ERRORS.has('dom_extract_failed'));
  assert.ok(FALLBACK_ERRORS.has('risk_check_required'));
});
