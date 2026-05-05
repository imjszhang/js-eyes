'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isXiaohongshuUrl,
  isXhsShortUrl,
  processXiaohongshuUrl,
  extractNoteIdFromUrl,
  extractUserIdFromUrl,
  buildNoteUrl,
  buildSearchUrl,
  buildUserUrl,
  parseCountText,
  sanitizeForRecording,
  normalizeXhsUrl,
} = require('../lib/xhsUtils');

test('isXiaohongshuUrl / isXhsShortUrl', () => {
  assert.equal(isXiaohongshuUrl('https://www.xiaohongshu.com/explore/abc'), true);
  assert.equal(isXiaohongshuUrl('https://xhslink.com/abcd'), true);
  assert.equal(isXhsShortUrl('https://xhslink.com/abcd'), true);
  assert.equal(isXiaohongshuUrl('https://www.example.com/'), false);
});

test('processXiaohongshuUrl 把 /search_result/<id> 改成 /explore/<id>', () => {
  const out = processXiaohongshuUrl('https://www.xiaohongshu.com/search_result/abc?xsec_token=t1');
  assert.match(out, /\/explore\/abc/);
  assert.match(out, /xsec_token=t1/);
});

test('processXiaohongshuUrl 把 /discovery/item/<id> 改成 /explore/<id>', () => {
  const out = processXiaohongshuUrl('https://www.xiaohongshu.com/discovery/item/abc');
  assert.match(out, /\/explore\/abc/);
});

test('extractNoteIdFromUrl 各种路径', () => {
  assert.equal(extractNoteIdFromUrl('https://www.xiaohongshu.com/explore/abc123'), 'abc123');
  assert.equal(extractNoteIdFromUrl('https://www.xiaohongshu.com/discovery/item/xyz789'), 'xyz789');
  assert.equal(extractNoteIdFromUrl('https://www.xiaohongshu.com/search_result/abc'), 'abc');
  assert.equal(extractNoteIdFromUrl('https://www.example.com/'), null);
});

test('extractUserIdFromUrl', () => {
  assert.equal(extractUserIdFromUrl('https://www.xiaohongshu.com/user/profile/uid123'), 'uid123');
  assert.equal(extractUserIdFromUrl('https://www.xiaohongshu.com/explore/abc'), null);
});

test('buildNoteUrl / buildSearchUrl / buildUserUrl', () => {
  assert.equal(
    buildNoteUrl('abc', { xsec_token: 'tok' }),
    'https://www.xiaohongshu.com/explore/abc?xsec_token=tok',
  );
  assert.match(buildSearchUrl({ keyword: '穿搭' }), /search_result\?.*keyword=/);
  assert.equal(buildUserUrl('uid'), 'https://www.xiaohongshu.com/user/profile/uid');
});

test('parseCountText 处理 1.2万 / 13.5w / 数字', () => {
  assert.equal(parseCountText('1.2万'), 12000);
  assert.equal(parseCountText('13.5w'), 135000);
  assert.equal(parseCountText('1k'), 1000);
  assert.equal(parseCountText('99'), 99);
  assert.equal(parseCountText(''), null);
  assert.equal(parseCountText('abc'), null);
});

test('sanitizeForRecording 屏蔽 a1 / web_session', () => {
  const cookieHeader = 'a1=abc123; web_session=xyz; gid=foo; harmless=value';
  const out = sanitizeForRecording(cookieHeader);
  assert.match(out, /a1=<redacted>/);
  assert.match(out, /web_session=<redacted>/);
  assert.match(out, /harmless=value/);

  const obj = { a1: 'tok', payload: { web_session: 'sess', other: 'x' } };
  const masked = sanitizeForRecording(obj);
  assert.equal(masked.a1, '<redacted>');
  assert.equal(masked.payload.web_session, '<redacted>');
  assert.equal(masked.payload.other, 'x');
});

test('normalizeXhsUrl 去 hash 与 utm_*', () => {
  const out = normalizeXhsUrl('https://www.xiaohongshu.com/explore/abc?utm_source=foo&xsec_token=t#a');
  assert.match(out, /xsec_token=t/);
  assert.doesNotMatch(out, /utm_source/);
  assert.doesNotMatch(out, /#a/);
});
