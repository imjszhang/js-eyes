'use strict';

/**
 * v3.x PR-9：cookie / a1 / web_session sanitize 单测。
 * 关键安全：history / debug 落盘前必须 mask。
 */

const test = require('node:test');
const assert = require('node:assert');

const { sanitizeForRecording } = require('../lib/xhsUtils');

test('sanitizeForRecording: a1 cookie value masked in cookie string', () => {
  const cookie = 'a1=18f3a2b9c1d2e3f4a5b6c7d8; web_session=03004486xyz; other=keep';
  const out = sanitizeForRecording(cookie);
  assert.match(out, /a1=<redacted>/);
  assert.match(out, /web_session=<redacted>/);
  assert.match(out, /other=keep/);
  assert.doesNotMatch(out, /18f3a2b9c1d2e3f4a5b6c7d8/);
  assert.doesNotMatch(out, /03004486xyz/);
});

test('sanitizeForRecording: object keys for a1/web_session redacted', () => {
  const obj = {
    cookies: { a1: 'AAA', web_session: 'BBB', keep: 'OK' },
    request: { headers: { cookie: 'a1=AAA; web_session=BBB' } },
  };
  const out = sanitizeForRecording(obj);
  assert.strictEqual(out.cookies.a1, '<redacted>');
  assert.strictEqual(out.cookies.web_session, '<redacted>');
  assert.strictEqual(out.cookies.keep, 'OK');
  assert.match(out.request.headers.cookie, /a1=<redacted>/);
  assert.match(out.request.headers.cookie, /web_session=<redacted>/);
});

test('sanitizeForRecording: arrays processed recursively', () => {
  const arr = ['a1=secret; foo=bar', { a1: 'zzz' }, 'plain'];
  const out = sanitizeForRecording(arr);
  assert.match(out[0], /a1=<redacted>/);
  assert.match(out[0], /foo=bar/);
  assert.strictEqual(out[1].a1, '<redacted>');
  assert.strictEqual(out[2], 'plain');
});

test('sanitizeForRecording: non-sensitive strings untouched', () => {
  const s = 'note_id=123; xsec_token=abc';
  const out = sanitizeForRecording(s);
  assert.strictEqual(out, s);
});

test('sanitizeForRecording: handles null / undefined / primitives', () => {
  assert.strictEqual(sanitizeForRecording(null), null);
  assert.strictEqual(sanitizeForRecording(undefined), undefined);
  assert.strictEqual(sanitizeForRecording(123), 123);
  assert.strictEqual(sanitizeForRecording(true), true);
});

test('sanitizeForRecording: webId / gid / acw_tc also masked', () => {
  const cookie = 'webId=W123; gid=G456; acw_tc=AC789';
  const out = sanitizeForRecording(cookie);
  assert.match(out, /webId=<redacted>/);
  assert.match(out, /gid=<redacted>/);
  assert.match(out, /acw_tc=<redacted>/);
});

test('sanitizeForRecording: mixed nested shape mimicking debug bundle', () => {
  const bundle = {
    audit: {
      input: { url: 'https://www.xiaohongshu.com/explore/abc' },
      cookies: 'a1=SECRET; web_session=SECRET2',
    },
    bridgeMeta: { name: 'note-bridge', version: '0.1.0' },
    a1: 'TOPLEVELSECRET',
  };
  const out = sanitizeForRecording(bundle);
  assert.strictEqual(out.audit.input.url, 'https://www.xiaohongshu.com/explore/abc');
  assert.match(out.audit.cookies, /a1=<redacted>/);
  assert.match(out.audit.cookies, /web_session=<redacted>/);
  assert.strictEqual(out.a1, '<redacted>');
  assert.strictEqual(out.bridgeMeta.name, 'note-bridge');
});
