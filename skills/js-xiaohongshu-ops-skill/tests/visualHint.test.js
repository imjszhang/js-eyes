'use strict';

/**
 * v3.1 PR-V6: visualHint.js 单测。
 * 覆盖 9 个工具的 hint 形态、buildSummary 与 extractPayload 在 ok/err 下不抛、
 * note/comment/user 三类卡片 anchorId 命名空间正确。
 */

const test = require('node:test');
const assert = require('node:assert');

const { getVisualHint, buildSummary, extractPayload } = require('../lib/visualHint');

const TOOLS = [
  'xhs_session_state',
  'xhs_get_note',
  'xhs_get_note_comments',
  'xhs_search_notes',
  'xhs_get_user',
  'xhs_get_user_notes',
  'xhs_navigate_note',
  'xhs_navigate_search',
  'xhs_navigate_user',
  'xhs_navigate_home',
];

test('getVisualHint: 所有 9 个工具都有 hint，必填字段非空', () => {
  for (const tool of TOOLS) {
    const hint = getVisualHint(tool, { url: 'https://www.xiaohongshu.com/explore/abc123def456' });
    assert.ok(hint, `${tool} 缺 hint`);
    assert.strictEqual(hint.toolName, tool);
    assert.ok(['global', 'item', 'list', 'navigation'].includes(hint.kind), `${tool} kind=${hint.kind} 非法`);
    assert.ok(hint.label && hint.label.length > 0, `${tool} label 空`);
  }
});

test('getVisualHint: 未知工具返回降级 hint', () => {
  const hint = getVisualHint('xhs_unknown_tool', {});
  assert.strictEqual(hint.kind, 'global');
  assert.strictEqual(hint.label, 'xhs_unknown_tool');
});

test('xhs_get_note: anchor 从 explore URL 提取 noteId', () => {
  const hint = getVisualHint('xhs_get_note', {
    url: 'https://www.xiaohongshu.com/explore/6936473d000000001b026ce9?xsec_token=abc',
  });
  assert.strictEqual(hint.kind, 'item');
  assert.deepStrictEqual(hint.anchor, { noteId: '6936473d000000001b026ce9' });
});

test('xhs_get_note: anchor 从 user/profile URL 提取 noteId', () => {
  const hint = getVisualHint('xhs_get_note', {
    url: 'https://www.xiaohongshu.com/user/profile/uid123/6936473d000000001b026ce9',
  });
  assert.deepStrictEqual(hint.anchor, { noteId: '6936473d000000001b026ce9' });
});

test('xhs_get_user: anchor.userId 从 args.userId', () => {
  const hint = getVisualHint('xhs_get_user', { userId: 'u_42' });
  assert.deepStrictEqual(hint.anchor, { userId: 'u_42' });
});

test('buildSummary: ok=false 不抛，errorCode 透传', () => {
  const hint = getVisualHint('xhs_get_note', { url: 'x' });
  const s = buildSummary({ ok: false, error: { code: 'login_required', message: 'no session' } }, hint);
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.errorCode, 'login_required');
});

test('buildSummary: list+notes → items 用 noteId 命名空间', () => {
  const hint = getVisualHint('xhs_search_notes', { keyword: '穿搭' });
  const s = buildSummary({
    ok: true,
    result: { notes: [{ noteId: 'n1' }, { id: 'n2' }] },
  }, hint);
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.items.length, 2);
  assert.strictEqual(s.items[0].noteId, 'n1');
  assert.strictEqual(s.items[1].noteId, 'n2');
});

test('extractPayload: list+notes → items 卡片含 id=note:<noteId>', () => {
  const hint = getVisualHint('xhs_search_notes', { keyword: '美食' });
  const p = extractPayload({
    ok: true,
    result: {
      keyword: '美食',
      notes: [
        { noteId: 'a1', title: 't1', user: { nickname: 'alice' }, stats: { likes: 10 } },
      ],
    },
  }, hint);
  assert.ok(p);
  assert.strictEqual(p.items.length, 1);
  assert.strictEqual(p.items[0].id, 'note:a1');
  assert.strictEqual(p.items[0].noteId, 'a1');
  assert.strictEqual(p.items[0].author, 'alice');
});

test('extractPayload: item+note → card 单条', () => {
  const hint = getVisualHint('xhs_get_note', { url: 'https://www.xiaohongshu.com/explore/abc' });
  const p = extractPayload({
    ok: true,
    result: { note: { noteId: 'abc', title: 'hello' } },
  }, hint);
  assert.strictEqual(p.id, 'note:abc');
  assert.strictEqual(p.noteId, 'abc');
});

test('extractPayload: navigation → from/to 透传', () => {
  const hint = getVisualHint('xhs_navigate_search', { keyword: '美食' });
  const p = extractPayload({
    ok: true,
    result: { from: 'https://www.xiaohongshu.com/', to: 'https://www.xiaohongshu.com/search_result?keyword=%E7%BE%8E%E9%A3%9F' },
  }, hint);
  assert.strictEqual(p.hint, 'page_will_reload');
  assert.match(p.to, /search_result/);
});

test('extractPayload: list+comments → items 用 commentId 命名空间', () => {
  const hint = getVisualHint('xhs_get_note_comments', { url: 'https://www.xiaohongshu.com/explore/abc' });
  const p = extractPayload({
    ok: true,
    result: {
      comments: [
        { id: 'c1', content: 'hi', user: { nickname: 'bob' } },
        { commentId: 'c2', content: 'yo' },
      ],
    },
  }, hint);
  assert.strictEqual(p.items.length, 2);
  assert.strictEqual(p.items[0].id, 'comment:c1');
  assert.strictEqual(p.items[1].id, 'comment:c2');
});

test('extractPayload: thrown error → error 字段', () => {
  const hint = getVisualHint('xhs_get_note', { url: 'x' });
  const err = new Error('fetch boom');
  err.code = 'fetch_failed';
  const p = extractPayload(null, hint, err);
  assert.ok(p && p.error);
  assert.strictEqual(p.error.code, 'fetch_failed');
  assert.strictEqual(p.error.message, 'fetch boom');
});

test('global hint (session_state): cookieFlags.hasWebSession 进 fields', () => {
  const hint = getVisualHint('xhs_session_state', {});
  const p = extractPayload({
    ok: true,
    result: { loggedIn: true, cookieFlags: { hasWebSession: true, hasA1: true } },
  }, hint);
  assert.ok(p);
  const sessionField = p.fields.find((f) => f.k === 'web_session');
  assert.ok(sessionField && sessionField.v === 'yes');
});
