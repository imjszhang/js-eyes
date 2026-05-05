'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 用临时目录作为 monitor home
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-monitor-test-'));
process.env.JS_XHS_MONITOR_HOME = tmpDir;

const cfgMod = require('../lib/monitor/config');
const { partitionNewNotes, hashContent, pruneExpired } = require('../lib/monitor/dedup');
const paths = require('../lib/monitor/paths');
const stateMod = require('../lib/monitor/state');

test('config schema v1 默认值 + validate 通过', () => {
  const cfg = cfgMod.defaultConfig();
  const v = cfgMod.validate(cfg);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(cfg.$schemaVersion, 1);
  assert.deepEqual(cfg.accounts, []);
  assert.deepEqual(cfg.searches, []);
});

test('config validate 拒绝 accounts 缺 username 与 userId', () => {
  const cfg = cfgMod.defaultConfig();
  cfg.accounts.push({ enabled: true });
  const v = cfgMod.validate(cfg);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /username/.test(e)));
});

test('config validate 拒绝 searches 缺 keyword', () => {
  const cfg = cfgMod.defaultConfig();
  cfg.searches.push({});
  const v = cfgMod.validate(cfg);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /keyword/.test(e)));
});

test('config validate 拒绝非法 channel type', () => {
  const cfg = cfgMod.defaultConfig();
  cfg.channels.push({ name: 'a', type: 'bad', url: 'http://x' });
  const v = cfgMod.validate(cfg);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /channels\[0\]\.type/.test(e)));
});

test('paths.targetStateKey 区分 user / search', () => {
  const k1 = paths.targetStateKey({ type: 'account', username: 'Alice' });
  const k2 = paths.targetStateKey({ type: 'account', username: 'alice' });
  assert.equal(k1, k2);
  const k3 = paths.targetStateKey({ type: 'search', keyword: '穿搭' });
  assert.match(k3, /^search-[0-9a-f]{12}$/);
});

test('partitionNewNotes 区分 fresh / seen', () => {
  const state = { notes: [{ noteId: 'a', hash: hashContent('hello') }] };
  const fetched = [
    { noteId: 'a', title: 'hello' },        // 已知
    { noteId: 'b', title: 'world' },        // 新
  ];
  const { fresh, seen } = partitionNewNotes(fetched, state, 'id_and_hash');
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].note.noteId, 'b');
  assert.equal(seen.length, 1);
});

test('pruneExpired 按 historyDays 裁剪', () => {
  const now = Date.now();
  const records = [
    { noteId: 'fresh', discoveredAt: new Date(now - 86400000).toISOString() },
    { noteId: 'old', discoveredAt: new Date(now - 60 * 86400000).toISOString() },
  ];
  const out = pruneExpired(records, 30, now);
  assert.equal(out.length, 1);
  assert.equal(out[0].noteId, 'fresh');
});

test('state.loadState ENOENT 返回空骨架', () => {
  const s = stateMod.loadState({ type: 'account', username: 'no-such' });
  assert.deepEqual(s.notes, []);
  assert.equal(s.lastCheck, null);
});

test('state.saveState 与 loadState 闭环', () => {
  const target = { type: 'account', username: 'roundtrip' };
  stateMod.saveState(target, { target, lastCheck: '2026-01-01T00:00:00Z', lastError: null, notes: [{ noteId: 'x' }] });
  const s = stateMod.loadState(target);
  assert.equal(s.lastCheck, '2026-01-01T00:00:00Z');
  assert.equal(s.notes.length, 1);
  assert.equal(s.notes[0].noteId, 'x');
});
