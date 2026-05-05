'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contract = require('../skill.contract');

test('contract 暴露 v3.0 的全部 AI 工具（6 READ + 4 INTERACTIVE + 5 monitor）', () => {
  const names = contract.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'xhs_get_note',
    'xhs_get_note_comments',
    'xhs_get_user',
    'xhs_get_user_notes',
    'xhs_monitor_add_target',
    'xhs_monitor_get_status',
    'xhs_monitor_list_targets',
    'xhs_monitor_remove_target',
    'xhs_monitor_test_target',
    'xhs_navigate_home',
    'xhs_navigate_note',
    'xhs_navigate_search',
    'xhs_navigate_user',
    'xhs_search_notes',
    'xhs_session_state',
  ]);
});

test('monitor 工具集合不包含 init/check/daemon/stop（这些只在 CLI 暴露）', () => {
  const names = contract.tools.map((t) => t.name);
  assert.equal(names.includes('xhs_monitor_init'), false);
  assert.equal(names.includes('xhs_monitor_check'), false);
  assert.equal(names.includes('xhs_monitor_daemon'), false);
  assert.equal(names.includes('xhs_monitor_stop'), false);
});

test('所有工具 destructive=false（小红书 ops skill 永不引入 DESTRUCTIVE）', () => {
  for (const tool of contract.tools) {
    assert.equal(tool.destructive, false, `${tool.name} should be non-destructive`);
  }
});

test('READ 工具 interactive=false，navigate 工具 interactive=true', () => {
  for (const tool of contract.tools) {
    if (tool.name.startsWith('xhs_navigate_')) {
      assert.equal(tool.interactive, true, `${tool.name} should be interactive`);
    } else {
      assert.equal(tool.interactive, false, `${tool.name} should be non-interactive`);
    }
  }
});

test('xhs_get_note 参数 schema 含 readMode 与 withComments / maxCommentPages', () => {
  const tool = contract.tools.find((t) => t.name === 'xhs_get_note');
  assert.ok(tool);
  const props = tool.parameters.properties;
  assert.ok(props.url);
  assert.ok(props.readMode);
  assert.deepEqual(props.readMode.enum, ['auto', 'dom', 'api']);
  assert.ok(props.withComments);
  assert.ok(props.maxCommentPages);
});

test('contract 暴露 makeReadToolExecutor / makeNavigateToolExecutor 工厂', () => {
  assert.equal(typeof contract.makeReadToolExecutor, 'function');
  assert.equal(typeof contract.makeBridgeReadExecutor, 'function');
  assert.equal(typeof contract.makeNavigateToolExecutor, 'function');
});

test('contract.cli.commands 至少包含 note / comments / session-state', () => {
  const names = contract.cli.commands.map((c) => c.name);
  assert.ok(names.includes('note'));
  assert.ok(names.includes('comments'));
  assert.ok(names.includes('session-state'));
});
