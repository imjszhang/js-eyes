'use strict';

// @builtin/hud
// ---------------------------------------------------------------------------
// HUD overlay plugin。从 v0.6.x 内置在 lib/hudClips.js + lib/timelineScript.js 的
// HUD 段提取出来；接口完全等价：
//   - 渲染右上角 .jse-hud <aside> 节点（每条 hud clip 一个 id="hud-i"）
//   - GSAP timeline 在 hud.tStart 处 fromTo opacity 0→1 + y -8→0
//   - duration ≥ 0.5s 走 fade-out，否则 set opacity 0
//
// v0.6.x 老行为完全等价，零回归（template mode 默认通过 CLI alias 引入）。
// ---------------------------------------------------------------------------

const { getHudCss } = require('./style');

const NAME = '@builtin/hud';
const VERSION = '1.0.0';

function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderHudAside(h){
  const tone = String(h.tone || 'info');
  const action = h.action ? '<p class="hud-action">' + escapeHtml(h.action) + '</p>' : '';
  const target = h.target ? '<p class="hud-target">' + escapeHtml(h.target) + '</p>' : '';
  const detail = h.detail ? '<p class="hud-detail">' + escapeHtml(h.detail) + '</p>' : '';
  return [
    '<aside',
    '  id="' + escapeHtml(h.id) + '"',
    '  class="clip jse-hud"',
    '  data-tone="' + escapeHtml(tone) + '"',
    '  data-start="' + Number(h.tStart || 0).toFixed(3) + '"',
    '  data-duration="' + Number(h.duration || 0).toFixed(3) + '"',
    '  data-track-index="1"',
    '>',
    action,
    target,
    detail,
    '</aside>',
  ].filter(Boolean).join('\n');
}

const plugin = {
  name: NAME,
  version: VERSION,

  injectHead(){
    return '<style data-jse-plugin="' + NAME + '">\n' + getHudCss() + '\n</style>';
  },

  injectBody(ctx){
    const huds = ctx.timeline && Array.isArray(ctx.timeline.hud) ? ctx.timeline.hud : [];
    if (!huds.length) return '';
    return huds.map(renderHudAside).join('\n');
  },

  injectTimeline(ctx){
    const huds = ctx.timeline && Array.isArray(ctx.timeline.hud) ? ctx.timeline.hud : [];
    if (!huds.length) return '';
    const lines = [];
    for (const h of huds) {
      const dHud = Math.max(0.05, Number(h.duration) || 0);
      const fadeIn = Math.min(0.18, Math.max(0.04, dHud * 0.4));
      const tIn = Math.max(0, Number(h.tStart) || 0);
      const tEnd = tIn + dHud;
      lines.push('  tl.fromTo("#' + h.id + '", { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: ' + fadeIn.toFixed(3) + ', ease: "power2.out" }, ' + tIn.toFixed(3) + ');');
      if (dHud >= 0.5) {
        const fadeOut = 0.18;
        const tOut = tEnd - fadeOut;
        lines.push('  tl.to("#' + h.id + '", { opacity: 0, duration: ' + fadeOut.toFixed(3) + ', ease: "power2.in" }, ' + tOut.toFixed(3) + ');');
      } else {
        lines.push('  tl.set("#' + h.id + '", { opacity: 0 }, ' + tEnd.toFixed(3) + ');');
      }
    }
    return lines.join('\n');
  },

  contributeSummary(ctx){
    const huds = ctx.timeline && Array.isArray(ctx.timeline.hud) ? ctx.timeline.hud : [];
    return { version: VERSION, hudCount: huds.length };
  },
};

module.exports = plugin;
