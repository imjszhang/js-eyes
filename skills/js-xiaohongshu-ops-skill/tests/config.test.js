'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PAGE_PROFILES, getPageProfile, isXhsHostname, DEFAULT_PAGE } = require('../lib/config');

test('PAGE_PROFILES 包含 note/search/user/home 四个 profile', () => {
  assert.deepEqual(Object.keys(PAGE_PROFILES).sort(), ['home', 'note', 'search', 'user']);
});

test('每个 profile 都有 score(tab) / bridgePath / bridgeGlobal', () => {
  for (const [, profile] of Object.entries(PAGE_PROFILES)) {
    assert.equal(typeof profile.score, 'function');
    assert.ok(profile.bridgePath);
    assert.ok(profile.bridgeGlobal && profile.bridgeGlobal.startsWith('__jse_xhs_'));
  }
});

test('note profile.score 命中 /explore/<id> +500，命中 /discovery/item/<id> +500', () => {
  const note = PAGE_PROFILES.note;
  assert.ok(note.score({ url: 'https://www.xiaohongshu.com/explore/abc123' }) >= 500);
  assert.ok(note.score({ url: 'https://www.xiaohongshu.com/discovery/item/abc123' }) >= 500);
  assert.ok(note.score({ url: 'https://www.xiaohongshu.com/explore/abc?xsec_token=xxx', is_active: true }) >= 1500);
  assert.equal(note.score({ url: 'https://www.google.com/' }), 0);
});

test('note profile.score 短链 xhslink.com 给 100', () => {
  const note = PAGE_PROFILES.note;
  assert.ok(note.score({ url: 'https://xhslink.com/abcd' }) >= 100);
});

test('search profile.score 命中 /search_result +500', () => {
  const s = PAGE_PROFILES.search;
  assert.ok(s.score({ url: 'https://www.xiaohongshu.com/search_result?keyword=foo' }) >= 500);
});

test('user profile.score 命中 /user/profile/<id> +500', () => {
  const u = PAGE_PROFILES.user;
  assert.ok(u.score({ url: 'https://www.xiaohongshu.com/user/profile/abc' }) >= 500);
});

test('home profile.score 命中根路径与 /explore +500', () => {
  const h = PAGE_PROFILES.home;
  assert.ok(h.score({ url: 'https://www.xiaohongshu.com/' }) >= 500);
  assert.ok(h.score({ url: 'https://www.xiaohongshu.com/explore' }) >= 500);
});

test('isXhsHostname 识别 xiaohongshu.com 与 xhslink.com', () => {
  assert.equal(isXhsHostname('www.xiaohongshu.com'), true);
  assert.equal(isXhsHostname('edith.xiaohongshu.com'), true);
  assert.equal(isXhsHostname('xhslink.com'), true);
  assert.equal(isXhsHostname('a.xhscdn.com'), true);
  assert.equal(isXhsHostname('example.com'), false);
});

test('getPageProfile 默认返回 DEFAULT_PAGE', () => {
  assert.equal(getPageProfile().name, DEFAULT_PAGE);
});

test('getPageProfile 未知 profile 抛 E_BAD_ARG', () => {
  assert.throws(() => getPageProfile('unknown'), (err) => err.code === 'E_BAD_ARG');
});
