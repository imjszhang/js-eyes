'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// ---- mock fetchAccount before requiring runCheck ----
// runCheckCore 依赖 require('./fetchAccount').fetchAccount；为了不启动真实
// 浏览器，这里直接污染 require cache，把 fetchAccount 替换成数组驱动的 stub。

const fetchAccountModPath = require.resolve('../lib/monitor/fetchAccount');

/**
 * 注册一批 fetchAccount 返回值。调用顺序按账号顺序消费。
 * 同一 username 多次调用时按队列顺序弹出。
 */
const queues = new Map();
function enqueueFetchResult(username, result) {
  const lower = String(username).toLowerCase();
  if (!queues.has(lower)) queues.set(lower, []);
  queues.get(lower).push(result);
}
function clearQueues() {
  queues.clear();
}
function stubFetchAccount(browser, settings /* , options */) {
  const lower = String(settings.username).toLowerCase();
  const q = queues.get(lower);
  if (!q || q.length === 0) {
    return Promise.resolve({
      ok: false,
      username: settings.username,
      tweets: [],
      rawCount: 0,
      profile: null,
      error: { message: 'no stub enqueued', code: 'E_TEST_NO_STUB' },
      meta: null,
    });
  }
  return Promise.resolve(q.shift());
}

require.cache[fetchAccountModPath] = {
  id: fetchAccountModPath,
  filename: fetchAccountModPath,
  loaded: true,
  exports: { fetchAccount: stubFetchAccount },
};

const { runCheckCore } = require('../lib/monitor/runCheck');
const { defaultConfig } = require('../lib/monitor/config');

function buildConfigWithAccount(username) {
  const cfg = defaultConfig();
  cfg.accounts = [{ username, enabled: true }];
  return cfg;
}

function makeTweet(id, content) {
  return {
    tweetId: String(id),
    content: content || `tweet-${id}`,
    publishTime: new Date().toISOString(),
    isRetweet: false,
    isReply: false,
  };
}

function makeFetchOk(username, tweets) {
  return {
    ok: true,
    username,
    tweets,
    rawCount: tweets.length,
    profile: null,
    meta: { totalResults: tweets.length, bridgeUsed: true },
  };
}

test('runCheckCore 首次运行：所有推文都是 fresh', async () => {
  clearQueues();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-core-first-'));
  try {
    const cfg = buildConfigWithAccount('alice');
    enqueueFetchResult('alice', makeFetchOk('alice', [makeTweet(1), makeTweet(2), makeTweet(3)]));

    const res = await runCheckCore({
      config: cfg,
      browser: {},
      options: { stateHome: base },
    });

    assert.equal(res.ok, true);
    assert.equal(res.totals.accounts, 1);
    assert.equal(res.totals.fetched, 3);
    assert.equal(res.totals.fresh, 3);

    const acct = res.accounts[0];
    assert.equal(acct.username, 'alice');
    assert.equal(acct.fresh, 3);
    assert.equal(acct.freshEntries.length, 3);
    assert.ok(acct.freshEntries.every((e) => e.record && e.record.hash));

    const stateFile = path.join(base, 'state', 'alice.json');
    assert.ok(fs.existsSync(stateFile), 'state 文件应已落盘');
    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(persisted.tweets.length, 3);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('runCheckCore 第二次相同输入：全部 seen，fresh 为空', async () => {
  clearQueues();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-core-second-'));
  try {
    const cfg = buildConfigWithAccount('alice');
    const tweets = [makeTweet(10), makeTweet(11)];
    enqueueFetchResult('alice', makeFetchOk('alice', tweets));
    enqueueFetchResult('alice', makeFetchOk('alice', tweets));

    await runCheckCore({ config: cfg, browser: {}, options: { stateHome: base } });
    const second = await runCheckCore({ config: cfg, browser: {}, options: { stateHome: base } });

    assert.equal(second.totals.fresh, 0);
    assert.equal(second.accounts[0].fresh, 0);
    assert.equal(second.accounts[0].seen, 2);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('runCheckCore 增量场景：只返回新推文为 fresh', async () => {
  clearQueues();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-core-incr-'));
  try {
    const cfg = buildConfigWithAccount('alice');
    enqueueFetchResult('alice', makeFetchOk('alice', [makeTweet(20), makeTweet(21)]));
    enqueueFetchResult(
      'alice',
      makeFetchOk('alice', [makeTweet(22, 'newest'), makeTweet(20), makeTweet(21)])
    );

    await runCheckCore({ config: cfg, browser: {}, options: { stateHome: base } });
    const second = await runCheckCore({ config: cfg, browser: {}, options: { stateHome: base } });

    assert.equal(second.totals.fresh, 1);
    assert.equal(second.accounts[0].fresh, 1);
    assert.equal(second.accounts[0].freshEntries[0].tweet.tweetId, '22');
    assert.equal(second.accounts[0].seen, 2);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('runCheckCore writeState=false 时不落盘', async () => {
  clearQueues();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-core-no-write-'));
  try {
    const cfg = buildConfigWithAccount('bob');
    enqueueFetchResult('bob', makeFetchOk('bob', [makeTweet(30)]));

    const res = await runCheckCore({
      config: cfg,
      browser: {},
      options: { stateHome: base, writeState: false },
    });

    assert.equal(res.totals.fresh, 1);
    const stateFile = path.join(base, 'state', 'bob.json');
    assert.equal(fs.existsSync(stateFile), false, 'writeState=false 不应落盘');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('runCheckCore fetchAccount 失败时 account.ok=false 且 error 被透传', async () => {
  clearQueues();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-core-fail-'));
  try {
    const cfg = buildConfigWithAccount('carol');
    enqueueFetchResult('carol', {
      ok: false,
      username: 'carol',
      tweets: [],
      rawCount: 0,
      profile: null,
      error: { message: 'network down', code: 'E_NETWORK' },
      meta: null,
    });

    const res = await runCheckCore({ config: cfg, browser: {}, options: { stateHome: base } });
    assert.equal(res.ok, false);
    assert.equal(res.accounts[0].ok, false);
    assert.equal(res.accounts[0].error.message, 'network down');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('runCheckCore debugSteps 收到关键事件', async () => {
  clearQueues();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-core-steps-'));
  try {
    const cfg = buildConfigWithAccount('dave');
    enqueueFetchResult('dave', makeFetchOk('dave', [makeTweet(40)]));

    const steps = [];
    await runCheckCore({
      config: cfg,
      browser: {},
      options: { stateHome: base, debugSteps: steps },
    });

    const stages = steps.map((s) => s.stage);
    assert.ok(stages.includes('check_start'));
    assert.ok(stages.includes('fetch_start'));
    assert.ok(stages.includes('fetch_done'));
    assert.ok(stages.includes('dedup'));
    assert.ok(stages.includes('check_core_end'));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
