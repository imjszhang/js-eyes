'use strict';

// @js-eyes/visual-bridge-kit · node/visualPalette.js
// ---------------------------------------------------------------------------
// 共享色板/常量。运行时 bridge 与离线转译器都从这里读，避免颜色双源。
// 与 styles/visual-runtime.css 中 [data-tone] 选择器**保持一一对应**。
// ---------------------------------------------------------------------------

const TONE_MAP = Object.freeze({
  info:    { border: '#1677ff', fill: 'rgba(22, 119, 255, 0.14)', pill: '#0958d9', text: '#f0f5ff' },
  pending: { border: '#faad14', fill: 'rgba(250, 173, 20, 0.16)', pill: '#ad6800', text: '#fffbe6' },
  success: { border: '#52c41a', fill: 'rgba(82, 196, 26, 0.14)',  pill: '#237804', text: '#f6ffed' },
  error:   { border: '#ff4d4f', fill: 'rgba(255, 77, 79, 0.14)',  pill: '#a8071a', text: '#fff1f0' },
  danger:  { border: '#ff4d4f', fill: 'rgba(255, 77, 79, 0.14)',  pill: '#a8071a', text: '#fff1f0' },
  warn:    { border: '#faad14', fill: 'rgba(250, 173, 20, 0.16)', pill: '#ad6800', text: '#fffbe6' },
});

const TONE_KEYS = Object.freeze(Object.keys(TONE_MAP));

function toneSpec(tone){
  return TONE_MAP[tone] || TONE_MAP.info;
}

module.exports = {
  TONE_MAP,
  TONE_KEYS,
  toneSpec,
};
