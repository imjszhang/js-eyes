'use strict';

/**
 * post-2.7.0 architecture pivot：HTML 数据驱动 replay 的 GSAP 时间轴。
 *
 * 核心变化：
 *   - 没有 frames track（PNG 截图链路下线）
 *   - flash 不再 fromTo 绝对坐标盒子；而是给 [data-anchor-id="<spec>"] 节点
 *     临时 add .flash-active class，CSS keyframes 自动跑 outline + glow，
 *     duration 结束后 remove。视口任意尺寸 → 卡片自适应 → flash 跟随。
 *   - HUD 按时间轴渐入渐出固定卡片节点（<div class="jse-hud" id="hud-i">）
 *   - 进度条按 durationSec 走 width
 *   - HUD/flash/relation 的 mount 状态全部在 GSAP 控制下，不会出现叠加残影
 *
 * @param {{ compositionId: string, hud: Array, flash: Array, relation: Array, durationSec: number }} info
 * @returns {string} <script>...</script>
 */
function buildTimelineScript(info){
  const id = info.compositionId;
  const hud = Array.isArray(info.hud) ? info.hud : [];
  const flash = Array.isArray(info.flash) ? info.flash : [];
  const relation = Array.isArray(info.relation) ? info.relation : [];
  const cards = Array.isArray(info.cards) ? info.cards : [];
  const dur = Math.max(0.5, Number(info.durationSec) || 0.5);

  const lines = [];
  lines.push('(function () {');
  lines.push('  var g = (typeof window !== "undefined" && window.gsap) ? window.gsap : null;');
  lines.push('  if (!g) {');
  lines.push('    console.warn("[jse-replay] GSAP not present; HUD will be visible without animation");');
  lines.push('    return;');
  lines.push('  }');
  lines.push('  if (typeof window.__timelines !== "object" || !window.__timelines) window.__timelines = {};');
  lines.push('  var $ = function(sel){ try { return document.querySelector(sel); } catch (_) { return null; } };');
  lines.push('  var $all = function(sel){ try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (_) { return []; } };');
  lines.push('  var addClassByAnchor = function(anchorId, cls, tone){');
  lines.push('    if (!anchorId) return;');
  lines.push('    var nodes = $all("[data-anchor-id=\\"" + String(anchorId).replace(/"/g, "\\\\\\"") + "\\"]");');
  lines.push('    nodes.forEach(function(n){');
  lines.push('      n.classList.add(cls);');
  lines.push('      if (tone) n.setAttribute("data-tone", tone);');
  lines.push('    });');
  lines.push('  };');
  lines.push('  var removeClassByAnchor = function(anchorId, cls){');
  lines.push('    if (!anchorId) return;');
  lines.push('    var nodes = $all("[data-anchor-id=\\"" + String(anchorId).replace(/"/g, "\\\\\\"") + "\\"]");');
  lines.push('    nodes.forEach(function(n){ n.classList.remove(cls); });');
  lines.push('  };');
  lines.push('  // hyperframes 渲染要求确定性时长（不能 repeat: -1）。');
  lines.push('  // standalone 浏览器预览模式下 800ms 后通过 .repeat(-1) 打开循环。');
  lines.push('  var tl = g.timeline({ paused: true });');

  // ---- card 入场（每张卡片在 cards.tStart 时刻显示） ----
  for (const c of cards) {
    const tIn = Math.max(0, c.tStart || 0);
    lines.push('  tl.fromTo("#' + c.id + '", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.32, ease: "power2.out" }, ' + tIn.toFixed(3) + ');');
    if (Number.isFinite(c.tEnd) && c.tEnd > tIn + 0.6) {
      const tOut = Math.max(tIn + 0.32, c.tEnd - 0.18);
      lines.push('  tl.to("#' + c.id + '", { opacity: 0, duration: 0.18, ease: "power2.in" }, ' + tOut.toFixed(3) + ');');
    } else {
      lines.push('  tl.set("#' + c.id + '", { opacity: 0 }, ' + (Number.isFinite(c.tEnd) ? c.tEnd : (tIn + 4)).toFixed(3) + ');');
    }
  }

  // ---- HUD ----
  for (const h of hud) {
    const dHud = Math.max(0.05, h.duration);
    const fadeIn = Math.min(0.18, Math.max(0.04, dHud * 0.4));
    const tIn = h.tStart;
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

  // ---- Flash：class 切换 ----
  // 同 anchorId 多次 flash 时各自独立 add/remove；动画由 CSS keyframes 跑。
  for (const f of flash) {
    if (!f.anchorId) continue;
    const tIn = Math.max(0, f.tStart);
    const dF = Math.max(0.1, Math.min(0.6, f.duration));
    const tOff = tIn + dF;
    const tone = String(f.tone || 'info').replace(/[^a-z]/g, '');
    lines.push('  tl.add(function(){ addClassByAnchor(' + JSON.stringify(f.anchorId) + ', "flash-active", ' + JSON.stringify(tone) + '); }, ' + tIn.toFixed(3) + ');');
    lines.push('  tl.add(function(){ removeClassByAnchor(' + JSON.stringify(f.anchorId) + ', "flash-active"); }, ' + tOff.toFixed(3) + ');');
  }

  // ---- Relation：from/to 各自做一次短 flash ----
  for (const r of relation) {
    const tIn = Math.max(0, r.tStart);
    const dR = Math.max(0.2, r.duration);
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

  // ---- 进度条 ----
  lines.push('  tl.to(".jse-progress > .bar", { width: "100%", duration: ' + dur.toFixed(3) + ', ease: "none" }, 0);');

  lines.push('  window.__timelines[' + JSON.stringify(id) + '] = tl;');
  lines.push('  console.log("[jse-replay] timeline registered (post-2.7.0 HTML pivot), hud=' + hud.length + ', flash=' + flash.length + ', rel=' + relation.length + ', cards=' + cards.length + ', dur=' + dur.toFixed(3) + 's");');
  lines.push('  setTimeout(function(){');
  lines.push('    if (window.__hyperframesActive) { console.log("[jse-replay] hyperframes active; deferring playback"); return; }');
  lines.push('    if (typeof tl.progress === "function" && tl.progress() === 0 && tl.paused()) {');
  lines.push('      try { tl.repeat(-1).repeatDelay(0.6); } catch (_) {}');
  lines.push('      console.log("[jse-replay] standalone mode: starting loop playback");');
  lines.push('      tl.play();');
  lines.push('    }');
  lines.push('  }, 800);');
  lines.push('})();');

  return '<script>\n' + lines.join('\n') + '\n</script>';
}

module.exports = { buildTimelineScript };
