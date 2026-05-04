'use strict';

// v0.7: 覆盖 lifetime / stagger 三阶段相关的新字段在 parseVisualFlags 里的解析。

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVisualFlags, DEFAULTS } = require('../node/visualConfig');

test('DEFAULTS 暴露 v0.7 lifetime 字段（flashMs/lingerMs/pinnedHold/errorAsPinned/scrollSettleMs/staggerFadeIn）', () => {
  assert.equal(DEFAULTS.flashMs, 420);
  assert.equal(DEFAULTS.lingerMs, 5000);
  assert.equal(DEFAULTS.pinnedHold, 'next-call');
  assert.equal(DEFAULTS.errorAsPinned, true);
  assert.equal(DEFAULTS.scrollSettleMs, 80);
  assert.equal(DEFAULTS.staggerFadeIn, false);
  // durationMs 仍是 flashMs 的 alias，向后兼容
  assert.equal(DEFAULTS.durationMs, DEFAULTS.flashMs);
});

test('parseVisualFlags: 默认值原样落到 config', () => {
  const { config } = parseVisualFlags({});
  assert.equal(config.flashMs, 420);
  assert.equal(config.lingerMs, 5000);
  assert.equal(config.pinnedHold, 'next-call');
  assert.equal(config.errorAsPinned, true);
  assert.equal(config.scrollSettleMs, 80);
  assert.equal(config.staggerFadeIn, false);
});

test('parseVisualFlags: --visual-flash-ms 落到 flashMs 与 durationMs（双写 alias）', () => {
  const { config } = parseVisualFlags({ visualFlashMs: '600' });
  assert.equal(config.flashMs, 600);
  assert.equal(config.durationMs, 600);
});

test('parseVisualFlags: --visual-flash-ms clamp 到 120-4000', () => {
  const lo = parseVisualFlags({ visualFlashMs: '50' }).config;
  assert.equal(lo.flashMs, 120);
  const hi = parseVisualFlags({ visualFlashMs: '99999' }).config;
  assert.equal(hi.flashMs, 4000);
});

test('parseVisualFlags: --visual-linger-ms clamp 到 0-60000', () => {
  const ok = parseVisualFlags({ visualLingerMs: '8000' }).config;
  assert.equal(ok.lingerMs, 8000);
  const hi = parseVisualFlags({ visualLingerMs: '99999999' }).config;
  assert.equal(hi.lingerMs, 60000);
});

test('parseVisualFlags: --visual-pinned-hold 仅接收 next-call|manual', () => {
  assert.equal(parseVisualFlags({ visualPinnedHold: 'manual' }).config.pinnedHold, 'manual');
  assert.equal(parseVisualFlags({ visualPinnedHold: 'next-call' }).config.pinnedHold, 'next-call');
  // 非法值忽略，回到默认
  assert.equal(parseVisualFlags({ visualPinnedHold: 'forever' }).config.pinnedHold, 'next-call');
});

test('parseVisualFlags: --visual-no-error-pin 关掉 errorAsPinned', () => {
  const { config } = parseVisualFlags({ visualErrorPin: false });
  assert.equal(config.errorAsPinned, false);
});

test('parseVisualFlags: --visual-stagger-fadein 开关', () => {
  assert.equal(parseVisualFlags({ visualStaggerFadein: true }).config.staggerFadeIn, true);
  assert.equal(parseVisualFlags({ visualStaggerFadein: false }).config.staggerFadeIn, false);
});

test('parseVisualFlags: --visual-scroll-settle-ms clamp 到 0-2000', () => {
  assert.equal(parseVisualFlags({ visualScrollSettleMs: '120' }).config.scrollSettleMs, 120);
  assert.equal(parseVisualFlags({ visualScrollSettleMs: '5000' }).config.scrollSettleMs, 2000);
});

test('parseVisualFlags: 旧 --visual-ms 仍接收并映射到 flashMs，且进 deprecatedFlags', () => {
  const { config, deprecatedFlags } = parseVisualFlags({ visualMs: '600' });
  assert.equal(config.flashMs, 600);
  assert.equal(config.durationMs, 600);
  assert.ok(deprecatedFlags.includes('--visual-ms'));
});

test('parseVisualFlags: --visual-ms 与 --visual-flash-ms 同传时 visual-flash-ms 优先，且不进 deprecatedFlags', () => {
  const { config, deprecatedFlags } = parseVisualFlags({ visualMs: '300', visualFlashMs: '900' });
  assert.equal(config.flashMs, 900);
  assert.ok(!deprecatedFlags.includes('--visual-ms'));
});
