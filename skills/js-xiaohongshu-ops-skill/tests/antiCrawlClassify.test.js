'use strict';

/**
 * v3.1 PR-B2: WAF 四档分类（soft / captcha / hard）单测。
 * common.js 是浏览器代码，这里用 vm 在 shim 过的全局里执行，再取出函数引用。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCommon() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bridges', 'common.js'), 'utf8');
  const sandbox = {
    location: { href: 'https://www.xiaohongshu.com/explore', hostname: 'www.xiaohongshu.com' },
    document: { cookie: '', querySelector: () => null, querySelectorAll: () => [] },
    setTimeout, clearTimeout, console,
    Date, Math, JSON, RegExp, URL, AbortController: undefined,
    fetch: async () => { throw new Error('not used'); },
    Promise, Number,
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\n;module = { exports: {} };', sandbox);
  // 把要测的函数 / 状态从 sandbox 取出
  return {
    recordRiskHit: vm.runInContext('recordRiskHit', sandbox),
    snapshotAntiCrawl: vm.runInContext('snapshotAntiCrawl', sandbox),
    detectAntiCrawl: vm.runInContext('detectAntiCrawl', sandbox),
    cache: vm.runInContext('__jseXhsCache', sandbox),
    sandbox,
  };
}

test('recordRiskHit: 默认为 soft，连续 3 次 → paused', () => {
  const { recordRiskHit, snapshotAntiCrawl } = loadCommon();
  recordRiskHit('r1');
  recordRiskHit('r2');
  let snap = snapshotAntiCrawl();
  assert.strictEqual(snap.paused, false);
  assert.strictEqual(snap.kind, 'soft');
  assert.strictEqual(snap.softCount, 2);
  recordRiskHit('r3');
  snap = snapshotAntiCrawl();
  assert.strictEqual(snap.paused, true, 'soft 累计 3 次必须 paused');
  assert.strictEqual(snap.softCount, 3);
});

test('recordRiskHit: hard 一次就 paused，hardCount 增长', () => {
  const { recordRiskHit, snapshotAntiCrawl } = loadCommon();
  recordRiskHit('login_redirect', 'hard');
  const snap = snapshotAntiCrawl();
  assert.strictEqual(snap.paused, true);
  assert.strictEqual(snap.kind, 'hard');
  assert.strictEqual(snap.hardCount, 1);
});

test('recordRiskHit: captcha 累计 2 次 paused', () => {
  const { recordRiskHit, snapshotAntiCrawl } = loadCommon();
  recordRiskHit('http_461', 'captcha');
  let snap = snapshotAntiCrawl();
  assert.strictEqual(snap.paused, false);
  assert.strictEqual(snap.captchaCount, 1);
  recordRiskHit('http_461', 'captcha');
  snap = snapshotAntiCrawl();
  assert.strictEqual(snap.paused, true);
  assert.strictEqual(snap.captchaCount, 2);
  assert.strictEqual(snap.kind, 'captcha');
});

test('detectAntiCrawl: meta 缺失 → soft', () => {
  const ctx = loadCommon();
  const result = ctx.detectAntiCrawl({ note_like: '1', note_comment: null, note_collect: null });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.kind, 'soft');
  const snap = ctx.snapshotAntiCrawl();
  assert.strictEqual(snap.kind, 'soft');
});

test('detectAntiCrawl: location 是登录页 → hard', () => {
  const ctx = loadCommon();
  ctx.sandbox.location.href = 'https://www.xiaohongshu.com/login?redirect=/';
  const result = ctx.detectAntiCrawl({ note_like: null, note_comment: null, note_collect: null });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.kind, 'hard');
  const snap = ctx.snapshotAntiCrawl();
  assert.strictEqual(snap.paused, true);
  assert.strictEqual(snap.kind, 'hard');
});

test('detectAntiCrawl: meta 三件齐全 → ok 且不写状态', () => {
  const ctx = loadCommon();
  const result = ctx.detectAntiCrawl({ note_like: '1', note_comment: '2', note_collect: '3' });
  assert.strictEqual(result.ok, true);
  const snap = ctx.snapshotAntiCrawl();
  assert.strictEqual(snap.kind, null);
});

test('snapshotAntiCrawl: 快照字段完整', () => {
  const { snapshotAntiCrawl } = loadCommon();
  const snap = snapshotAntiCrawl();
  for (const k of ['paused', 'pauseUntil', 'consecutiveRiskHits', 'kind', 'lastReason', 'lastSeenAt', 'softCount', 'captchaCount', 'hardCount']) {
    assert.ok(k in snap, 'snapshot 缺字段 ' + k);
  }
});
