'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { expandBridgeSource, urlsEquivalent } = require('../lib/session');

test('expandBridgeSource inlines common bridge helpers', () => {
  const source = "(() => {\n  const VERSION = 'x';\n  // @@include common.js\n  return { ok: true };\n})()";
  const expanded = expandBridgeSource(source);
  assert.match(expanded, /function currentPageState/);
  assert.match(expanded, /function sessionState/);
});

test('urlsEquivalent ignores trailing slash and requires expected query params', () => {
  assert.equal(urlsEquivalent('https://www.zhihu.com/question/1/', 'https://www.zhihu.com/question/1'), true);
  assert.equal(urlsEquivalent('https://www.zhihu.com/search?q=a', 'https://www.zhihu.com/search?q=a&type=content'), false);
});
