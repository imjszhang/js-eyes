'use strict';

// 覆盖 v0.6.0 BREAKING：parseVisualFlags 解析 hud / flash 布尔位 + 把 visualMode
// 列入 deprecatedFlags（不再下发到 bridge config）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVisualFlags, DEFAULTS } = require('../node/visualConfig');

test('DEFAULTS exposes hud + flash booleans (no mode)', () => {
  assert.equal(DEFAULTS.hud, true);
  assert.equal(DEFAULTS.flash, true);
  assert.equal('mode' in DEFAULTS, false);
});

test('parseVisualFlags: defaults are hud=true / flash=true', () => {
  const { config } = parseVisualFlags({});
  assert.equal(config.hud, true);
  assert.equal(config.flash, true);
  assert.equal('mode' in config, false);
});

test('parseVisualFlags: --no-visual-hud disables hud only', () => {
  const { config } = parseVisualFlags({ visualHud: false });
  assert.equal(config.hud, false);
  assert.equal(config.flash, true);
});

test('parseVisualFlags: --no-visual-flash disables flash only', () => {
  const { config } = parseVisualFlags({ visualFlash: false });
  assert.equal(config.hud, true);
  assert.equal(config.flash, false);
});

test('parseVisualFlags: visualMode is hard-cut into deprecatedFlags (not down-fed)', () => {
  const { config, deprecatedFlags } = parseVisualFlags({ visualMode: 'hud' });
  // 不再写入 config.mode；hud / flash 仍是默认全开
  assert.equal('mode' in config, false);
  assert.equal(config.hud, true);
  assert.equal(config.flash, true);
  assert.ok(deprecatedFlags.includes('--visual-mode'));
});

test('parseVisualFlags: --visual=false 仍正常落到 enabled', () => {
  const { config } = parseVisualFlags({ visual: false });
  assert.equal(config.enabled, false);
});
