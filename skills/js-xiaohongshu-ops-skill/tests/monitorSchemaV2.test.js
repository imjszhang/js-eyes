'use strict';

/**
 * v3.1 PR-C3 monitor schema v2 草案 + migrate v1→v2 hook 单测。
 * 注意：CURRENT_SCHEMA_VERSION 仍是 1；schema v2 仅作为草案 + 显式开启项。
 * 验收：
 *   - migrateV1ToV2 把 v1 配置升到 v2，新字段全部就位
 *   - 默认 migrate() 不会触发 v2（除非环境变量开启）
 *   - 已是 v2 的配置二次跑 migrateV1ToV2 不破坏
 */

const test = require('node:test');
const assert = require('node:assert');

const { migrate, migrateV1ToV2, CURRENT_SCHEMA_VERSION, SCHEMA_V2_DRAFT } = require('../lib/monitor/config');

test('CURRENT_SCHEMA_VERSION 仍是 1（未确认 B1 报告前不切换）', () => {
  assert.strictEqual(CURRENT_SCHEMA_VERSION, 1);
  assert.strictEqual(SCHEMA_V2_DRAFT, 2);
});

test('migrateV1ToV2: 注入 groups[] / priority / notify.dedupWindow', () => {
  const v1 = {
    $schemaVersion: 1,
    accounts: [{ username: 'alice' }, { userId: 'u2', priority: 'invalid' }],
    searches: [{ keyword: '穿搭' }, { keyword: '美食', priority: 'high' }],
    defaults: { summaryLength: 100 },
  };
  const v2 = migrateV1ToV2(JSON.parse(JSON.stringify(v1)));
  assert.strictEqual(v2.$schemaVersion, 2);
  assert.deepStrictEqual(v2.groups, []);
  assert.strictEqual(v2.accounts[0].priority, 'normal');
  assert.strictEqual(v2.accounts[1].priority, 'normal', '非法 priority 必须降级为 normal');
  assert.strictEqual(v2.searches[0].priority, 'normal');
  assert.strictEqual(v2.searches[1].priority, 'high');
  assert.deepStrictEqual(v2.defaults.notify, { dedupWindow: 0 });
  assert.strictEqual(v2.defaults.summaryLength, 100, '原有字段保留');
});

test('migrateV1ToV2: 已是 v2 二次执行幂等', () => {
  const v2 = migrateV1ToV2({ $schemaVersion: 1, accounts: [{ username: 'a', priority: 'low' }] });
  const v2Again = migrateV1ToV2(v2);
  assert.strictEqual(v2Again.$schemaVersion, 2);
  assert.strictEqual(v2Again.accounts[0].priority, 'low');
});

test('默认 migrate() 不触发 v2（环境变量未开）', () => {
  delete process.env.JS_XHS_MONITOR_SCHEMA_V2;
  const out = migrate({ $schemaVersion: 1, accounts: [], searches: [] });
  assert.strictEqual(out.$schemaVersion, 1);
  assert.strictEqual(out.groups, undefined);
});

test('JS_XHS_MONITOR_SCHEMA_V2=1 时 migrate() 自动 v1→v2', () => {
  process.env.JS_XHS_MONITOR_SCHEMA_V2 = '1';
  try {
    const out = migrate({ $schemaVersion: 1, accounts: [{ username: 'b' }], searches: [] });
    assert.strictEqual(out.$schemaVersion, 2);
    assert.deepStrictEqual(out.groups, []);
    assert.strictEqual(out.accounts[0].priority, 'normal');
    assert.deepStrictEqual(out.defaults.notify, { dedupWindow: 0 });
  } finally {
    delete process.env.JS_XHS_MONITOR_SCHEMA_V2;
  }
});

test('migrateV1ToV2: 缺 defaults / notify 时也能正确补齐', () => {
  const v2 = migrateV1ToV2({});
  assert.strictEqual(v2.$schemaVersion, 2);
  assert.deepStrictEqual(v2.groups, []);
  assert.deepStrictEqual(v2.defaults.notify, { dedupWindow: 0 });
});
