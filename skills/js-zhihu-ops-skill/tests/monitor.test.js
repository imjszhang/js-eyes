'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

test('monitor config lifecycle works in an isolated home', () => {
  const oldHome = process.env.JS_ZHIHU_MONITOR_HOME;
  process.env.JS_ZHIHU_MONITOR_HOME = path.join(os.tmpdir(), `zhihu-monitor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  delete require.cache[require.resolve('../lib/runMonitor')];
  delete require.cache[require.resolve('../lib/monitor/config')];
  delete require.cache[require.resolve('../lib/monitor/paths')];
  const monitor = require('../lib/runMonitor');
  try {
    const init = monitor.initConfig({ force: true });
    assert.equal(init.created, true);
    const added = monitor.addTarget({ type: 'search', keyword: '大模型', limit: 3 });
    assert.equal(added.ok, true);
    assert.equal(added.targets.searches.length, 1);
    const dryRun = monitor.testTarget({ type: 'search', keyword: '大模型' });
    assert.equal(dryRun.ok, true);
    assert.match(dryRun.targetUrl, /zhihu\.com\/search/);
    const removed = monitor.removeTarget({ type: 'search', value: '大模型' });
    assert.equal(removed.removed, 1);
  } finally {
    if (oldHome == null) delete process.env.JS_ZHIHU_MONITOR_HOME;
    else process.env.JS_ZHIHU_MONITOR_HOME = oldHome;
  }
});
