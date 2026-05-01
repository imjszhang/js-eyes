'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { resolveMonitorHome, resolvePaths, stateFile } = require('../lib/monitor/paths');
const { loadState, saveState } = require('../lib/monitor/state');

test('resolveMonitorHome 优先使用显式 home 参数', () => {
  const explicit = '/tmp/monitor-home-test-1';
  const prevEnv = process.env.JS_X_MONITOR_HOME;
  process.env.JS_X_MONITOR_HOME = '/tmp/from-env';
  try {
    const home = resolveMonitorHome({ home: explicit });
    assert.equal(home, path.resolve(explicit));
  } finally {
    if (prevEnv === undefined) delete process.env.JS_X_MONITOR_HOME;
    else process.env.JS_X_MONITOR_HOME = prevEnv;
  }
});

test('resolveMonitorHome 未传 opts 时走 env / 默认', () => {
  const prevEnv = process.env.JS_X_MONITOR_HOME;
  process.env.JS_X_MONITOR_HOME = '/tmp/from-env-2';
  try {
    assert.equal(resolveMonitorHome(), path.resolve('/tmp/from-env-2'));
  } finally {
    if (prevEnv === undefined) delete process.env.JS_X_MONITOR_HOME;
    else process.env.JS_X_MONITOR_HOME = prevEnv;
  }
});

test('resolvePaths({ home }) 下属路径全部基于显式 home 展开', () => {
  const base = '/tmp/monitor-home-test-3';
  const p = resolvePaths({ home: base });
  assert.equal(p.base, path.resolve(base));
  assert.equal(p.configFile, path.join(path.resolve(base), 'config.json'));
  assert.equal(p.stateDir, path.join(path.resolve(base), 'state'));
  assert.equal(p.logsDir, path.join(path.resolve(base), 'logs'));
  assert.equal(p.pidFile, path.join(path.resolve(base), 'daemon.pid'));
});

test('stateFile 把 username 转小写并放到 stateDir 下', () => {
  const base = '/tmp/monitor-home-test-4';
  const f = stateFile('ElonMusk', { home: base });
  assert.equal(f, path.join(path.resolve(base), 'state', 'elonmusk.json'));
});

test('saveState / loadState with { home } 真实读写到独立目录', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-statehome-'));
  try {
    const state = {
      username: 'alice',
      lastCheck: '2026-05-01T00:00:00.000Z',
      lastError: null,
      tweets: [{ tweetId: '123', hash: 'abc', publishTime: null, discoveredAt: '2026-05-01T00:00:00.000Z' }],
    };
    const written = saveState('alice', state, { home: base });
    assert.equal(written, path.join(base, 'state', 'alice.json'));
    const read = loadState('alice', { home: base });
    assert.equal(read.username, 'alice');
    assert.equal(read.tweets.length, 1);
    assert.equal(read.tweets[0].tweetId, '123');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('loadState on empty home 返回空 skeleton，不抛错', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-statehome-empty-'));
  try {
    const read = loadState('nobody', { home: base });
    assert.equal(read.username, 'nobody');
    assert.deepEqual(read.tweets, []);
    assert.equal(read.lastCheck, null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('不同 home 的 state 互相隔离', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-home-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-home-b-'));
  try {
    saveState(
      'alice',
      { username: 'alice', lastCheck: null, lastError: null, tweets: [{ tweetId: 'A', hash: 'h', discoveredAt: new Date().toISOString() }] },
      { home: a }
    );
    const inB = loadState('alice', { home: b });
    assert.deepEqual(inB.tweets, []);
    const inA = loadState('alice', { home: a });
    assert.equal(inA.tweets.length, 1);
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
