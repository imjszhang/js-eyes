'use strict';

// @js-eyes/visual-bridge-kit/dev
// ---------------------------------------------------------------------------
// post-2.7.0 architecture pivot 后，PNG 截图链路（chrome.tabs.captureVisibleTab
// → frames/<ts>.png）已从主链路下线。但 captureFrame.js 与相关 helpers 代码保留，
// 通过本子路径暴露给开发 / debug / 历史回归使用：
//
//   const {
//     makeFrameWriter,
//     writeFrameSync,
//     buildFrameRef,
//     attachFrameRefsToEvents,
//   } = require('@js-eyes/visual-bridge-kit/dev');
//
// 用法示例（手动开 PNG 路线，仅 dev）：
//   const writer = makeFrameWriter({ outDir: 'runs/dev-frames', tabId, callRaw });
//   await wrapCallApi(session, hint, () => session.callApi(method, args), {
//     extractPayload, // 主链路：业务数据
//     captureFrame: writer, // dev only：仍想留 PNG 底图
//   });
//
// A 路线主链路（HTML 数据驱动 replay）不消费这些 frame，hyperframes translator
// 也不再读 frames/。这些工具留着仅为：
//   1) 兼容旧会话 fixture（packages/visual-replay-hyperframes/__fixtures__/sess-firefox-2.7.0/）的回归
//   2) 为后续可能的混合方案（HTML 卡片 + PNG 缩略叠层）保留实现入口
// ---------------------------------------------------------------------------

const { makeFrameWriter, writeFrameSync } = require('../node/captureFrame');
const { buildFrameRef, attachFrameRefsToEvents } = require('../node/runVisual');

module.exports = {
  makeFrameWriter,
  writeFrameSync,
  buildFrameRef,
  attachFrameRefsToEvents,
};
