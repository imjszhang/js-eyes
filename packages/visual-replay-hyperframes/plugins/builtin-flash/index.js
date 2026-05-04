'use strict';

// @builtin/flash
// ---------------------------------------------------------------------------
// flash + relation 动画 plugin。从 v0.6.x lib/timelineScript.js 的 flash/relation
// 段提取而成；接口完全等价：
//   - flash clip：在 tStart 给 [data-anchor-id=anchorId] 节点 add .flash-active
//     (+data-tone)，duration 后 remove
//   - relation clip：from anchor 立刻 highlight，0.18s 后 to anchor 也 highlight，
//     各自 ≈ 600ms 后 remove
//
// 依赖 timelineScript 在 IIFE 头部已经定义的 addClassByAnchor / removeClassByAnchor
// 帮手——pluginHost 拼接顺序保证 plugin timeline 段在 helpers 之后；plugin 自己
// 不再重复声明 helper（避免 var redeclare 噪音）。
// ---------------------------------------------------------------------------

const { getFlashCss } = require('./style');

const NAME = '@builtin/flash';
const VERSION = '1.0.0';

const plugin = {
  name: NAME,
  version: VERSION,

  injectHead(){
    return '<style data-jse-plugin="' + NAME + '">\n' + getFlashCss() + '\n</style>';
  },

  injectTimeline(ctx){
    const flash = ctx.timeline && Array.isArray(ctx.timeline.flash) ? ctx.timeline.flash : [];
    const relation = ctx.timeline && Array.isArray(ctx.timeline.relation) ? ctx.timeline.relation : [];
    if (!flash.length && !relation.length) return '';

    const lines = [];

    for (const f of flash) {
      if (!f.anchorId) continue;
      const tIn = Math.max(0, Number(f.tStart) || 0);
      const dF = Math.max(0.1, Math.min(0.6, Number(f.duration) || 0.3));
      const tOff = tIn + dF;
      const tone = String(f.tone || 'info').replace(/[^a-z]/g, '');
      lines.push('  tl.add(function(){ addClassByAnchor(' + JSON.stringify(f.anchorId) + ', "flash-active", ' + JSON.stringify(tone) + '); }, ' + tIn.toFixed(3) + ');');
      lines.push('  tl.add(function(){ removeClassByAnchor(' + JSON.stringify(f.anchorId) + ', "flash-active"); }, ' + tOff.toFixed(3) + ');');
    }

    for (const r of relation) {
      const tIn = Math.max(0, Number(r.tStart) || 0);
      const dR = Math.max(0.2, Number(r.duration) || 0.7);
      const tOff = tIn + Math.min(0.6, dR);
      const tone = String(r.tone || 'info').replace(/[^a-z]/g, '');
      if (r.fromAnchorId) {
        lines.push('  tl.add(function(){ addClassByAnchor(' + JSON.stringify(r.fromAnchorId) + ', "flash-active", ' + JSON.stringify(tone) + '); }, ' + tIn.toFixed(3) + ');');
        lines.push('  tl.add(function(){ removeClassByAnchor(' + JSON.stringify(r.fromAnchorId) + ', "flash-active"); }, ' + tOff.toFixed(3) + ');');
      }
      if (r.toAnchorId) {
        const t2 = tIn + 0.18;
        lines.push('  tl.add(function(){ addClassByAnchor(' + JSON.stringify(r.toAnchorId) + ', "flash-active", ' + JSON.stringify(tone) + '); }, ' + t2.toFixed(3) + ');');
        lines.push('  tl.add(function(){ removeClassByAnchor(' + JSON.stringify(r.toAnchorId) + ', "flash-active"); }, ' + (t2 + Math.min(0.6, dR)).toFixed(3) + ');');
      }
    }

    return lines.join('\n');
  },

  contributeSummary(ctx){
    const flash = ctx.timeline && Array.isArray(ctx.timeline.flash) ? ctx.timeline.flash : [];
    const relation = ctx.timeline && Array.isArray(ctx.timeline.relation) ? ctx.timeline.relation : [];
    return { version: VERSION, flashCount: flash.length, relationCount: relation.length };
  },
};

module.exports = plugin;
