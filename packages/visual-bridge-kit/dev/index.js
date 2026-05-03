'use strict';

// @js-eyes/visual-bridge-kit/dev
// ---------------------------------------------------------------------------
// v0.5.0 起，PNG/JPEG 截图链路（makeFrameWriter / buildFrameRef /
// writeFrameSync / attachFrameRefsToEvents）已升回顶层 index.js 主入口
// （snapshot mode 默认链路）。本子路径仅作 **历史兼容 alias**，所有
// 调用直接转发到顶层 export。
//
// 推荐新代码改用：
//   const { makeFrameWriter } = require('@js-eyes/visual-bridge-kit');
//
// 旧代码的 require('@js-eyes/visual-bridge-kit/dev') 仍能继续工作。
// ---------------------------------------------------------------------------

const top = require('../index');

module.exports = {
  makeFrameWriter: top.makeFrameWriter,
  writeFrameSync: top.writeFrameSync,
  buildFrameRef: top.buildFrameRef,
  attachFrameRefsToEvents: top.attachFrameRefsToEvents,
};
