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
} = require('./node/runVisual');
const { appendVisualTrace, readVisualTrace } = require('./node/visualTrace');
const { loadVisualKitSource } = require('./node/loadKit');

const BRIDGE_VISUAL_PATH = path.join(__dirname, 'bridge', 'visual.common.js');
const BRIDGE_ANCHOR_TEMPLATE_PATH = path.join(__dirname, 'bridge', 'anchorResolver.template.js');

module.exports = {
  // bridge include
  makeBridgeExpander,
  resolveIncludeTarget,
  BRIDGE_VISUAL_PATH,
  BRIDGE_ANCHOR_TEMPLATE_PATH,

  // CLI flags
  parseVisualFlags,
  injectBridgeConfigSnippet,
  VISUAL_DEFAULTS: DEFAULTS,

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

  // trace
  appendVisualTrace,
  readVisualTrace,
};
