'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateConfig, defaultConfig } = require('../lib/monitor/config');

test('validateConfig 对默认 config 返回 ok=true', () => {
  const res = validateConfig(defaultConfig());
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.equal(res.config.$schemaVersion, 1);
});

test('validateConfig 能识别非法 channel type', () => {
  const cfg = defaultConfig();
  cfg.channels = [
    { name: 'main', type: 'feishu', url: 'https://x/y' },
    { name: 'broken', type: 'teams', url: 'https://x/y' },
  ];
  const res = validateConfig(cfg);
  assert.equal(res.ok, false);
  assert.ok(
    res.errors.some((e) => e.includes('channels[1].type 非法')),
    `errors 里应包含 channels[1].type 非法，实际: ${JSON.stringify(res.errors)}`
  );
});

test('validateConfig 对缺少 channel.url 的非 console 类型报错', () => {
  const cfg = defaultConfig();
  cfg.channels = [{ name: 'main', type: 'feishu' }];
  const res = validateConfig(cfg);
  assert.equal(res.ok, false);
  assert.ok(
    res.errors.some((e) => e.includes('channels[0].url 必填')),
    `errors 应包含 url 必填，实际: ${JSON.stringify(res.errors)}`
  );
});

test('validateConfig 允许 console 类型不带 url', () => {
  const cfg = defaultConfig();
  cfg.channels = [{ name: 'stdout', type: 'console' }];
  const res = validateConfig(cfg);
  assert.equal(res.ok, true, `errors: ${JSON.stringify(res.errors)}`);
});

test('validateConfig 对 accounts 非数组报错', () => {
  const cfg = defaultConfig();
  cfg.accounts = 'nope';
  const res = validateConfig(cfg);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('accounts 必须是数组')));
});

test('validateConfig 对非法 deduplication.method 报错', () => {
  const cfg = defaultConfig();
  cfg.deduplication = { method: 'weird' };
  const res = validateConfig(cfg);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('deduplication.method 非法')));
});
