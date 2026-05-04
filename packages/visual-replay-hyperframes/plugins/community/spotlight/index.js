'use strict';

// @js-eyes/spotlight
// ---------------------------------------------------------------------------
// Reference community plugin。消费 ctx.timeline.dom.locate[].rect 给已经录制的
// composition 加聚光灯效果：在每个 dom_locate 时刻把屏幕暗下来、只在目标 rect
// 中心留一个透明圆环。
//
// 配置项（--plugin-config '@js-eyes/spotlight={...}'）:
//   - radius: number    聚光圆半径（像素），默认 100
//   - dimAlpha: number  其余区域暗度（0~1），默认 0.55
//   - tone: string      'orange' | 'cyan' | 'green' | 自定 CSS 颜色，默认 'orange'
//   - duration: number  每次 spotlight 持续秒数，默认 0.9
//
// 设计注释：
//   - rect 是 client coords（dom_locate 在录制时拿的 getBoundingClientRect），
//     回放时舞台不一定全屏；snapshot 模式 #stage[data-mode="snapshot"] 就是
//     viewport 整体，这时坐标基本一致；template 模式则 best-effort（rect 为
//     回放时 viewport 内坐标，不一定贴卡片）。
//   - plugin 仅消费 timeline.dom（不读 frames/*.jpg 像素），符合"plugin 不能
//     pixel-read"的契约
//   - 没有任何 dom_locate 时 plugin 不输出 body/timeline，0 视觉残留
// ---------------------------------------------------------------------------

const { getSpotlightCss } = require('./style');

const NAME = '@js-eyes/spotlight';
const VERSION = '1.0.0';

const TONE_PRESETS = {
  orange: 'rgba(255,180,76,0.9)',
  cyan: 'rgba(76,217,255,0.9)',
  green: 'rgba(82,196,26,0.9)',
  red: 'rgba(255,92,92,0.9)',
};

function resolveTone(input){
  if (!input) return TONE_PRESETS.orange;
  const k = String(input).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(TONE_PRESETS, k)) return TONE_PRESETS[k];
  return String(input); // 直接当 CSS color 传入
}

function clampNum(v, lo, hi, dflt){
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

const plugin = {
  name: NAME,
  version: VERSION,

  injectHead(){
    return '<style data-jse-plugin="' + NAME + '">\n' + getSpotlightCss() + '\n</style>';
  },

  injectBody(ctx){
    const locates = ctx.timeline && ctx.timeline.dom && Array.isArray(ctx.timeline.dom.locate) ? ctx.timeline.dom.locate : [];
    if (!locates.length) return '';
    return '<div id="jse-spotlight-overlay" data-active="false"></div>';
  },

  injectTimeline(ctx){
    const locates = ctx.timeline && ctx.timeline.dom && Array.isArray(ctx.timeline.dom.locate) ? ctx.timeline.dom.locate : [];
    if (!locates.length) return '';

    const cfg = ctx.config || {};
    const radius = clampNum(cfg.radius, 20, 600, 100);
    const dimAlpha = clampNum(cfg.dimAlpha, 0, 1, 0.55);
    const tone = resolveTone(cfg.tone);
    const dur = clampNum(cfg.duration, 0.2, 6, 0.9);

    const lines = [];
    lines.push('  var __jseSpotEl = document.getElementById("jse-spotlight-overlay");');
    lines.push('  if (__jseSpotEl) {');
    lines.push('    __jseSpotEl.style.setProperty("--spotlight-radius", ' + JSON.stringify(radius + 'px') + ');');
    lines.push('    __jseSpotEl.style.setProperty("--spotlight-dim-alpha", ' + JSON.stringify(String(dimAlpha)) + ');');
    lines.push('    __jseSpotEl.style.setProperty("--spotlight-tone", ' + JSON.stringify(tone) + ');');
    lines.push('  }');
    lines.push('  var setSpotlight = function(rect, active){');
    lines.push('    if (!__jseSpotEl) return;');
    lines.push('    if (!active || !rect) { __jseSpotEl.style.display = "none"; __jseSpotEl.setAttribute("data-active", "false"); return; }');
    lines.push('    var x = rect.x;');
    lines.push('    var y = rect.y;');
    lines.push('    if (rect.width) x += rect.width / 2;');
    lines.push('    if (rect.height) y += rect.height / 2;');
    lines.push('    __jseSpotEl.style.display = "block";');
    lines.push('    __jseSpotEl.setAttribute("data-active", "true");');
    lines.push('    __jseSpotEl.style.setProperty("--spotlight-x", x + "px");');
    lines.push('    __jseSpotEl.style.setProperty("--spotlight-y", y + "px");');
    lines.push('  };');

    let count = 0;
    for (const loc of locates) {
      if (!loc || !loc.rect) continue;
      const tIn = Math.max(0, Number(loc.tStart) || 0);
      const tOff = tIn + dur;
      const rectArg = JSON.stringify({
        x: Number(loc.rect.x) || 0,
        y: Number(loc.rect.y) || 0,
        width: Number(loc.rect.width) || 0,
        height: Number(loc.rect.height) || 0,
      });
      lines.push('  tl.add(function(){ setSpotlight(' + rectArg + ', true); }, ' + tIn.toFixed(3) + ');');
      lines.push('  tl.add(function(){ setSpotlight(null, false); }, ' + tOff.toFixed(3) + ');');
      count += 1;
    }
    lines.push('  console.log("[jse-spotlight] registered " + ' + JSON.stringify(String(count)) + ' + " spotlight events");');
    return lines.join('\n');
  },

  contributeSummary(ctx){
    const locates = ctx.timeline && ctx.timeline.dom && Array.isArray(ctx.timeline.dom.locate) ? ctx.timeline.dom.locate : [];
    const withRect = locates.filter((l) => l && l.rect).length;
    return {
      version: VERSION,
      locateCount: locates.length,
      spotlightCount: withRect,
    };
  },
};

module.exports = plugin;
