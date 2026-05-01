'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// sessionStateCommon 位于 bridges/common.js，是 IIFE 里的函数，不能直接
// require。这里通过正则抽取函数体在 Node 里用手写 stub 的 readMeViaApi /
// readLoginStateDom 重建最小执行上下文，断言返回字段。

const commonSrc = fs.readFileSync(
  path.join(__dirname, '..', 'bridges', 'common.js'),
  'utf8'
);

function extractFn(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`无法定位函数: ${name}`);
  let depth = 0;
  let i = src.indexOf('{', m.index);
  const start = m.index;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(start, i + 1);
      }
    }
  }
  throw new Error(`函数 ${name} 未闭合`);
}

const fnSrc = extractFn(commonSrc, 'sessionStateCommon');

function buildSessionState({ apiResult, domResult }) {
  const scope = {
    okResult: (data) => ({ ok: true, data }),
    readLoginStateDom: () => domResult,
    readMeViaApi: async () => apiResult,
    location: { href: 'https://x.com/home', hostname: 'x.com' },
  };
  const keys = Object.keys(scope);
  const values = keys.map((k) => scope[k]);
  const factory = new Function(...keys, `${fnSrc}\nreturn sessionStateCommon;`);
  return factory(...values);
}

test('sessionStateCommon 返回 whoami 别名字段（已登录 via api）', async () => {
  const fn = buildSessionState({
    apiResult: { loggedIn: true, name: 'imjszhang', source: 'api' },
    domResult: { loggedIn: false, name: null, source: 'unknown' },
  });
  const res = await fn();
  assert.equal(res.ok, true);
  assert.equal(res.data.loggedIn, true);
  assert.equal(res.data.name, 'imjszhang');
  assert.equal(res.data.username, 'imjszhang');
  assert.equal(res.data.screenName, 'imjszhang');
  assert.equal(res.data.source, 'api');
  assert.equal(res.data.userId, null);
  assert.equal(res.data.displayName, null);
});

test('sessionStateCommon DOM 兜底（api 未返回）', async () => {
  const fn = buildSessionState({
    apiResult: { loggedIn: false, name: null, source: 'no-ct0' },
    domResult: { loggedIn: true, name: 'someone_else', source: 'profile-link' },
  });
  const res = await fn();
  assert.equal(res.data.loggedIn, true);
  assert.equal(res.data.username, 'someone_else');
  assert.equal(res.data.screenName, 'someone_else');
  assert.equal(res.data.source, 'dom');
});

test('sessionStateCommon 未登录返回 loggedIn=false 且所有 whoami 字段为 null', async () => {
  const fn = buildSessionState({
    apiResult: { loggedIn: false, name: null, source: 'api-error' },
    domResult: { loggedIn: false, name: null, source: 'login-button' },
  });
  const res = await fn();
  assert.equal(res.data.loggedIn, false);
  assert.equal(res.data.username, null);
  assert.equal(res.data.screenName, null);
  assert.equal(res.data.name, null);
});

test('sessionStateCommon 字段 schema 向后兼容（保留 name / api / dom）', async () => {
  const fn = buildSessionState({
    apiResult: { loggedIn: true, name: 'user', source: 'api' },
    domResult: { loggedIn: true, name: 'user', source: 'profile-link' },
  });
  const res = await fn();
  assert.ok(Object.prototype.hasOwnProperty.call(res.data, 'name'));
  assert.ok(Object.prototype.hasOwnProperty.call(res.data, 'api'));
  assert.ok(Object.prototype.hasOwnProperty.call(res.data, 'dom'));
  assert.ok(Object.prototype.hasOwnProperty.call(res.data, 'source'));
});
