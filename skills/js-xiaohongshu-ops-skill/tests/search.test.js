'use strict';

/**
 * search.test.js
 *
 * 覆盖 v3.2 搜索改造：
 *   - search-bridge 文件结构（VERSION bump、对齐参考实现的关键编排函数存在）
 *   - CLI parseArgv 支持 --extract-details / --details-limit
 *   - monitor effectiveSearchSettings 透传 extractDetails / detailsLimit（默认 false）
 *   - skill.contract.js xhs_search_notes 工具暴露 detailsLimit 参数
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SKILL_ROOT = path.resolve(__dirname, '..');

test('search-bridge VERSION bump 到 0.3.x，含编排关键函数', () => {
  const src = fs.readFileSync(path.join(SKILL_ROOT, 'bridges/search-bridge.js'), 'utf8');
  // 版本号
  const m = src.match(/const VERSION\s*=\s*'(\d+\.\d+\.\d+)'/);
  assert.ok(m, 'VERSION not found');
  const [maj, min] = m[1].split('.').map(Number);
  assert.ok(maj > 0 || (maj === 0 && min >= 3), `expect VERSION >= 0.3.0, got ${m[1]}`);

  // 关键函数：对齐参考实现
  for (const fn of [
    '_switchChannel',
    '_openFilterPanel',
    '_applyFilter',
    '_closeFilterPanel',
    '_extractDetailInline',
    '_extractFromNoteContainer',
    '_findCardAnchor',
    '_backToList',
    '_scrollAndCollect',
    'dom_search',
  ]) {
    assert.ok(src.includes(fn), `search-bridge 缺少函数 ${fn}`);
  }

  // selector 对齐：#channel-container / .filters-wrapper / .close-circle
  assert.ok(src.includes('#channel-container'), '应使用 #channel-container');
  assert.ok(src.includes('.filters-wrapper'), '应使用 .filters-wrapper');
  assert.ok(src.includes('close-circle'), '应识别 .close-circle .close 关闭按钮');

  // 不再使用旧 selector（伴随 0.2.1 的脆弱 nth-of-type 假设）
  assert.ok(!src.includes('.search-channel-list li'), '不应再使用 .search-channel-list li（已知抓站点主导航）');
  assert.ok(!/\.filter-group:nth-of-type/.test(src), '不应再使用 .filter-group:nth-of-type（与线上 DOM 不符）');
});

test('search-bridge dom_search 在 extractDetails 时输出 details 统计；不开时为 null', () => {
  const src = fs.readFileSync(path.join(SKILL_ROOT, 'bridges/search-bridge.js'), 'utf8');
  // detail 字段挂在 note 上，detailsStats 顶层返回
  assert.ok(/details:\s*detailsStats/.test(src), '应在 okResult 内输出 details 统计');
  assert.ok(/requested:\s*requested/.test(src), '应统计 requested');
  assert.ok(/succeeded:\s*succeeded/.test(src), '应统计 succeeded');
  assert.ok(/failed:\s*failed/.test(src), '应统计 failed');
});

test('search-bridge _extractDetailInline 失败不抛错（detail.error 透出）', () => {
  const src = fs.readFileSync(path.join(SKILL_ROOT, 'bridges/search-bridge.js'), 'utf8');
  // 必须存在多种失败路径：anchor 未找到 / 点击失败 / 无 noteContainer / 路由跳走
  assert.ok(src.includes("'card_anchor_not_found'"), 'anchor 未找到时应回 detail.error=card_anchor_not_found');
  assert.ok(src.includes("'no_note_container'"), '无 #noteContainer 时应回 detail.error=no_note_container');
  assert.ok(src.includes("'route_navigated'"), '详情走 route 而非模态时应回 detail.error=route_navigated');
});

test('CLI parseArgv 支持 --extract-details / --details-limit', () => {
  const { parseArgv } = require('../lib/commands');
  const r1 = parseArgv(['美食', '--extract-details', '--details-limit', '5']);
  assert.equal(r1.opts.extractDetails, true);
  assert.equal(r1.opts.detailsLimit, '5');
  assert.deepEqual(r1.positional, ['美食']);

  const r2 = parseArgv(['穿搭', '--extract-details', '--details-limit=8']);
  assert.equal(r2.opts.extractDetails, true);
  assert.equal(r2.opts.detailsLimit, '8');
});

test('CLI search command toArgs 把 detailsLimit 传到 bridge', () => {
  const { COMMANDS } = require('../lib/commands');
  const search = COMMANDS.search;
  assert.ok(search, 'search command 必须存在');
  const args = search.toArgs(
    { extractDetails: true, detailsLimit: '7', limit: '20' },
    ['美食'],
  );
  assert.equal(args[0].extractDetails, true);
  assert.equal(args[0].detailsLimit, 7);
  assert.equal(args[0].limit, 20);
  assert.equal(args[0].keyword, '美食');
});

test('monitor effectiveSearchSettings 默认 extractDetails=false 且可覆盖', () => {
  const { effectiveSearchSettings, defaultConfig } = require('../lib/monitor/config');
  const cfg = defaultConfig();
  // 默认
  const s1 = effectiveSearchSettings({ keyword: '美食' }, cfg);
  assert.equal(s1.extractDetails, false);
  assert.equal(s1.detailsLimit, null);
  // 显式开
  const s2 = effectiveSearchSettings({ keyword: '美食', extractDetails: true, detailsLimit: 5 }, cfg);
  assert.equal(s2.extractDetails, true);
  assert.equal(s2.detailsLimit, 5);
  // truthy 字符串不应误开
  const s3 = effectiveSearchSettings({ keyword: '美食', extractDetails: 'yes' }, cfg);
  assert.equal(s3.extractDetails, false, 'extractDetails 必须严格 ===true 才生效');
});

test('skill.contract.js xhs_search_notes 暴露 detailsLimit + 描述提到点开详情', () => {
  const contract = require('../skill.contract');
  const tool = contract.TOOL_DEFINITIONS.find((t) => t.name === 'xhs_search_notes');
  assert.ok(tool, 'xhs_search_notes 必须存在');
  assert.ok(tool.parameters.properties.detailsLimit, 'parameters 应含 detailsLimit');
  assert.equal(tool.parameters.properties.detailsLimit.type, 'number');
  assert.ok(/详情|点开/.test(tool.parameters.properties.extractDetails.description));
});

test('runTool buildCacheKeyParts 含 extractDetails / detailsLimit（源码扫描）', () => {
  const src = fs.readFileSync(path.join(SKILL_ROOT, 'lib/runTool.js'), 'utf8');
  assert.ok(/extractDetails:\s*!!\(args\s*&&\s*args\.extractDetails\)/.test(src),
    'cache key 应含 extractDetails');
  assert.ok(/detailsLimit:\s*\(args\s*&&\s*args\.detailsLimit\)/.test(src),
    'cache key 应含 detailsLimit');
});
