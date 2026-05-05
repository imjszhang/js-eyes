'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { XhsLimiter } = require('../lib/rateLimit/limiter');

test('XhsLimiter.schedule 串行执行任务且强制最小间隔', async () => {
  const limiter = new XhsLimiter({
    minIntervalMs: 50,
    maxRandomDelayMs: 0,
    maxConcurrent: 1,
    bucketCapacity: 10,
    refillIntervalMs: 1,
  });
  const stamps = [];
  await Promise.all([
    limiter.schedule(async () => stamps.push(Date.now())),
    limiter.schedule(async () => stamps.push(Date.now())),
    limiter.schedule(async () => stamps.push(Date.now())),
  ]);
  assert.equal(stamps.length, 3);
  // 串行 + 间隔 ≥ 50ms（容差 -10ms）
  assert.ok(stamps[1] - stamps[0] >= 40, `gap1 ${stamps[1] - stamps[0]}`);
  assert.ok(stamps[2] - stamps[1] >= 40, `gap2 ${stamps[2] - stamps[1]}`);
});

test('XhsLimiter snapshot 暴露关键计数', () => {
  const l = new XhsLimiter({ maxConcurrent: 2, bucketCapacity: 3 });
  const s = l.snapshot();
  assert.equal(s.tokens, 3);
  assert.equal(s.maxConcurrent, 2);
  assert.equal(s.inflight, 0);
});

test('antiCrawlingStats recordCall 累加并落盘到自定义文件', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmp = path.join(os.tmpdir(), `xhs-ac-${Date.now()}.json`);
  const { recordCall, readStats, resetStats } = require('../lib/rateLimit/antiCrawlingStats');
  resetStats(tmp);
  recordCall({ toolName: 'xhs_get_note', antiCrawlState: { paused: false, consecutiveRiskHits: 0 }, file: tmp });
  recordCall({ toolName: 'xhs_get_note', antiCrawlState: { paused: false, consecutiveRiskHits: 2 }, file: tmp });
  recordCall({ toolName: 'xhs_get_note', antiCrawlState: { paused: true, pauseUntil: Date.now() + 60000, consecutiveRiskHits: 3 }, file: tmp });
  const stats = readStats(tmp);
  assert.equal(stats.totalCalls, 3);
  assert.equal(stats.totalRiskHits, 2);
  assert.equal(stats.pauseEvents, 1);
  assert.equal(stats.consecutiveRiskHitsMax, 3);
  assert.equal(stats.perTool.xhs_get_note.calls, 3);
  fs.unlinkSync(tmp);
});
