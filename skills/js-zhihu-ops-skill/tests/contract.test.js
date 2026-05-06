'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const contract = require('../skill.contract');

test('contract exposes explicit safety flags for every tool', () => {
  assert.ok(Array.isArray(contract.tools));
  assert.ok(contract.tools.length >= 10);
  for (const tool of contract.tools) {
    assert.equal(typeof tool.interactive, 'boolean', tool.name);
    assert.equal(typeof tool.destructive, 'boolean', tool.name);
    assert.equal(tool.destructive, false, tool.name);
  }
});

test('contract includes upgraded read, navigation, and monitor tools', () => {
  const names = new Set(contract.tools.map((tool) => tool.name));
  for (const name of [
    'zhihu_get_answer',
    'zhihu_get_article',
    'zhihu_session_state',
    'zhihu_get_question_answers',
    'zhihu_search',
    'zhihu_get_user',
    'zhihu_navigate_answer',
    'zhihu_monitor_list_targets',
  ]) {
    assert.ok(names.has(name), name);
  }
});

test('runtime declares zhihu and zhuanlan platforms', () => {
  assert.deepEqual(contract.runtime.platforms, ['zhihu.com', 'zhuanlan.zhihu.com']);
});
