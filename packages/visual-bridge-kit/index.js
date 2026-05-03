'use strict';

// @js-eyes/visual-bridge-kit · index.js
// ---------------------------------------------------------------------------
// 聚合导出。bridge 侧文件请用 @@include @js-eyes/visual-bridge-kit/bridge/visual.common.js
// ---------------------------------------------------------------------------

const path = require('path');

const { makeBridgeExpander, resolveIncludeTarget } = require('./node/bridgeIncludes');
const { parseVisualFlags, injectBridgeConfigSnippet, DEFAULTS } = require('./node/visualConfig');
const {
  applyVisualConfig,
  wrapCallApi,
  wrapInjectCall,
  drainVisualEvents,
  buildBeforeExpression,
  buildAfterExpression,
  buildDrainExpression,
  buildConfigExpression,
  defaultBuildSummary,
  buildFrameRef,
  attachFrameRefsToEvents,
} = require('./node/runVisual');
const { makeFrameWriter, writeFrameSync } = require('./node/captureFrame');
const {
  appendVisualTrace,
  readVisualTrace,
  appendVisualSession,
  readVisualSession,
  updateVisualSessionMeta,
  KIT_VERSION,
  PAYLOAD_SCHEMA_VERSION,
} = require('./node/visualTrace');
const { loadVisualKitSource } = require('./node/loadKit');
const { TONE_MAP, TONE_KEYS, toneSpec } = require('./node/visualPalette');

const BRIDGE_VISUAL_PATH = path.join(__dirname, 'bridge', 'visual.common.js');
const BRIDGE_ANCHOR_TEMPLATE_PATH = path.join(__dirname, 'bridge', 'anchorResolver.template.js');
const STYLES_VISUAL_RUNTIME_CSS_PATH = path.join(__dirname, 'styles', 'visual-runtime.css');

module.exports = {
  // bridge include
  makeBridgeExpander,
  resolveIncludeTarget,
  BRIDGE_VISUAL_PATH,
  BRIDGE_ANCHOR_TEMPLATE_PATH,
  STYLES_VISUAL_RUNTIME_CSS_PATH,

  // CLI flags
  parseVisualFlags,
  injectBridgeConfigSnippet,
  VISUAL_DEFAULTS: DEFAULTS,
  KIT_VERSION,
  PAYLOAD_SCHEMA_VERSION,

  // hooks (long-lived bridge: reddit-ops style)
  applyVisualConfig,
  wrapCallApi,
  drainVisualEvents,

  // hooks (one-shot inject: browser-ops style)
  wrapInjectCall,
  loadVisualKitSource,

  // expression builders（高级用户自己拼装）
  buildBeforeExpression,
  buildAfterExpression,
  buildDrainExpression,
  buildConfigExpression,
  defaultBuildSummary,

  // trace（单文件）
  appendVisualTrace,
  readVisualTrace,

  // session bundle（目录形态，给 visual-replay-hyperframes 等下游消费）
  appendVisualSession,
  readVisualSession,
  updateVisualSessionMeta,

  // shared tone palette（运行时 + 离线消费者共用）
  TONE_MAP,
  TONE_KEYS,
  toneSpec,

  // v0.5.0: PNG/JPEG 截图链路重新升回主入口（snapshot mode 主链路）。
  // skill 端 wrapCallApi 调用时通过 hooks.captureFrame 接通，hyperframes
  // 默认渲染 PNG 序列；dev/index.js 仍可用作历史 alias。
  buildFrameRef,
  makeFrameWriter,
  writeFrameSync,
  attachFrameRefsToEvents,
};
