'use strict';

/**
 * v3.1 PR-V2: 验证 CLI argv → opts → parseVisualFlags 链路：
 *   - 6 种 flag 组合（visual / no-visual / visualHud / visualFlash / visualTrace / visualRecord）都能正确转化
 *   - deprecated flag 走告警去重（同一 flag 二次出现不打第二条）
 */

const test = require('node:test');
const assert = require('node:assert');

const { parseArgv } = require('../lib/commands');
const { parseVisualFlags } = require('@js-eyes/visual-bridge-kit');
const { warnDeprecatedFlagsOnce, resetWarnedFlagsForTesting } = require('../lib/cliVisualFlags');

function parse(argv) {
  return parseArgv(argv);
}

test('argv: --visual --visual-hud --visual-flash → enabled + hud + flash', () => {
  const { opts } = parse(['some', '--visual', '--visual-hud', '--visual-flash']);
  const vp = parseVisualFlags(opts);
  assert.strictEqual(vp.config.enabled, true);
  assert.strictEqual(vp.config.hud, true);
  assert.strictEqual(vp.config.flash, true);
  assert.strictEqual(vp.traceEnabled, false);
  assert.strictEqual(vp.recordEnabled, false);
});

test('argv: --no-visual → enabled=false', () => {
  const { opts } = parse(['x', '--no-visual']);
  const vp = parseVisualFlags(opts);
  assert.strictEqual(vp.config.enabled, false);
});

test('argv: --no-visual-hud --no-visual-flash → hud/flash 单独关', () => {
  const { opts } = parse(['x', '--no-visual-hud', '--no-visual-flash']);
  const vp = parseVisualFlags(opts);
  assert.strictEqual(vp.config.hud, false);
  assert.strictEqual(vp.config.flash, false);
});

test('argv: --visual-trace path → tracePath 解析为绝对路径', () => {
  const { opts } = parse(['x', '--visual-trace', './trace.jsonl']);
  const vp = parseVisualFlags(opts);
  assert.strictEqual(vp.traceEnabled, true);
  assert.ok(vp.tracePath && vp.tracePath.length > 0);
});

test('argv: --visual-record（无值，true）→ recordDir 自动生成', () => {
  const { opts } = parse(['x', '--visual-record']);
  const vp = parseVisualFlags(opts);
  assert.strictEqual(vp.recordEnabled, true);
  assert.ok(vp.recordDir && /sess-/.test(vp.recordDir));
});

test('argv: --visual-record=./out → recordDir 用显式路径', () => {
  const { opts } = parse(['x', '--visual-record=./out']);
  const vp = parseVisualFlags(opts);
  assert.strictEqual(vp.recordEnabled, true);
  assert.ok(vp.recordDir && vp.recordDir.endsWith('out'));
});

test('warnDeprecatedFlagsOnce: 重复 flag 只告警一次', () => {
  resetWarnedFlagsForTesting();
  const original = process.stderr.write;
  const calls = [];
  process.stderr.write = (chunk) => { calls.push(String(chunk)); return true; };
  try {
    warnDeprecatedFlagsOnce(['--visual-mode']);
    warnDeprecatedFlagsOnce(['--visual-mode']);
    warnDeprecatedFlagsOnce(['--visual-ms']);
  } finally {
    process.stderr.write = original;
  }
  assert.strictEqual(calls.length, 2, '同一个 flag 第二次不再告警；新 flag 仍会告警');
  assert.match(calls[0], /--visual-mode/);
  assert.match(calls[1], /--visual-ms/);
});
