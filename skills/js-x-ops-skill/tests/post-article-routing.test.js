'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyXPostInput } = require('../lib/xUrl');
const { postRunToolDispatch } = require('../lib/api');

test('Article inputs dispatch through getArticle methods', () => {
  const cls = classifyXPostInput('https://x.com/i/article/2076371937744302080');
  const dispatch = postRunToolDispatch(cls);
  assert.equal(dispatch.method, 'getArticle');
  assert.equal(dispatch.cmdDef.methodBase, 'getArticle');
  assert.equal(dispatch.cmdDef.apiSupported, true);
  assert.equal(dispatch.cmdDef.domSupported, true);
});

test('Tweet inputs keep the getPost route', () => {
  const cls = classifyXPostInput('https://x.com/example/status/2076479566516752527');
  const dispatch = postRunToolDispatch(cls);
  assert.equal(dispatch.method, 'getPost');
  assert.equal(dispatch.cmdDef.methodBase, 'getPost');
});
