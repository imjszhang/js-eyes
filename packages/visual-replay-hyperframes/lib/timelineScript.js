'use strict';

/**
 * post-2.7.0 architecture pivot：HTML 数据驱动 replay 的 GSAP 时间轴。
 * v0.6.0：snapshot-only-prune 后，只保留 setStageBackground 主链路 + HUD/flash
 * 两个 opt-in overlay。dom_* 合成动画 (cursor/typing/ripple/spinner/scroll)、
 * reddit shell sync (syncShellState) 全部下线——snapshot 模式下截图自带，
 * template 模式下没人用。
 *
 * 核心：
 *   - snapshot mode：#stage 双缓冲背景图 cross-fade（主链路）
 *   - template mode：每张卡片 fromTo 入场（list/item 兜底用）
 *   - HUD/flash 仅在 effects.hud / effects.flash 显式开启时输出 tween
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
  const frames = Array.isArray(info.frames) ? info.frames : [];
  const snapshotMode = info.snapshotMode === 'snapshot' ? 'snapshot' : 'template';
  const effectsCfg = info.effects && typeof info.effects === 'object' ? info.effects : {};
  const effects = {
    // v0.6.0：只剩 hud / flash 两个合成端 overlay；其它 dom_* effects 已删
    hud: !!effectsCfg.hud,
    flash: !!effectsCfg.flash,
  };
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

  // ---- card 入场（template 模式下 list/item 兜底卡片） ----
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

  // ---- HUD（受 effects.hud 控制；snapshot 模式默认关）----
  // hud DOM 在 effects.hud=false 时不渲染（buildHtml 已跳过 renderHudClips），这里
  // 只为了避免给不存在的 #hud-i 写 GSAP tween 而再做一次 gate。
  if (effects.hud) {
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
  }

  // ---- Flash：class 切换（受 effects.flash 控制）----
  if (effects.flash) {
    for (const f of flash) {
      if (!f.anchorId) continue;
      const tIn = Math.max(0, f.tStart);
      const dF = Math.max(0.1, Math.min(0.6, f.duration));
      const tOff = tIn + dF;
      const tone = String(f.tone || 'info').replace(/[^a-z]/g, '');
      lines.push('  tl.add(function(){ addClassByAnchor(' + JSON.stringify(f.anchorId) + ', "flash-active", ' + JSON.stringify(tone) + '); }, ' + tIn.toFixed(3) + ');');
      lines.push('  tl.add(function(){ removeClassByAnchor(' + JSON.stringify(f.anchorId) + ', "flash-active"); }, ' + tOff.toFixed(3) + ');');
    }

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
  }

  // ---- snapshot mode：#stage 背景图 cross-fade ----
  // 双缓冲：cur + next 两层 div，next 先 fade-in 再 cur 切图 next fade-out。
  // page-load 时立即把第一帧种到 .jse-frame-img-cur，避免 timeline play 延迟
  // 期间的"黑屏"；timeline 重播 (repeat -1) 时也用 first frame 复位。
  if (snapshotMode === 'snapshot' && frames.length) {
    const firstFrame = frames[0];
    const firstUrl = 'frames/' + (firstFrame.frameRef || '').replace(/^frames\//, '');
    const firstViewport = firstFrame.viewport || null;
    lines.push('  var __stage = document.getElementById("stage");');
    lines.push('  if (__stage) __stage.setAttribute("data-mode", "snapshot");');
    lines.push('  var __frameCur = __stage ? __stage.querySelector(".jse-frame-img-cur") : null;');
    lines.push('  var __frameNext = __stage ? __stage.querySelector(".jse-frame-img-next") : null;');
    lines.push('  if (__stage && !__frameCur) {');
    lines.push('    __frameCur = document.createElement("div");');
    lines.push('    __frameCur.className = "jse-frame-img-cur";');
    lines.push('    __stage.appendChild(__frameCur);');
    lines.push('  }');
    lines.push('  if (__stage && !__frameNext) {');
    lines.push('    __frameNext = document.createElement("div");');
    lines.push('    __frameNext.className = "jse-frame-img-next";');
    lines.push('    __stage.appendChild(__frameNext);');
    lines.push('  }');
    lines.push('  var setStageBackground = function(url, viewport){');
    lines.push('    if (!__stage || !__frameCur || !__frameNext) return;');
    lines.push('    if (viewport && viewport.cssW && viewport.cssH) {');
    lines.push('      __stage.style.setProperty("--snapshot-vp-w", viewport.cssW + "px");');
    lines.push('      __stage.style.setProperty("--snapshot-aspect", viewport.cssW + "/" + viewport.cssH);');
    lines.push('    }');
    lines.push('    __frameNext.style.backgroundImage = "url(\'" + url + "\')";');
    lines.push('    __frameNext.style.opacity = "1";');
    lines.push('    setTimeout(function(){');
    lines.push('      __frameCur.style.backgroundImage = "url(\'" + url + "\')";');
    lines.push('      __frameNext.style.opacity = "0";');
    lines.push('    }, 220);');
    lines.push('  };');
    lines.push('  if (__frameCur) {');
    lines.push('    __frameCur.style.backgroundImage = "url(\'" + ' + JSON.stringify(firstUrl) + ' + "\')";');
    if (firstViewport) {
      lines.push('    if (__stage) {');
      lines.push('      __stage.style.setProperty("--snapshot-vp-w", ' + JSON.stringify(String(firstViewport.cssW || firstViewport.w || 1280)) + ' + "px");');
      lines.push('      __stage.style.setProperty("--snapshot-aspect", ' + JSON.stringify((firstViewport.cssW || firstViewport.w || 1280) + '/' + (firstViewport.cssH || firstViewport.h || 720)) + ');');
      lines.push('    }');
    }
    lines.push('  }');
    lines.push('  tl.set("#stage .jse-frame-img-next", { opacity: 0 }, 0);');
    for (const f of frames) {
      if (!f.frameRef) continue;
      const t = Math.max(0, Number(f.tStart) || 0);
      const url = 'frames/' + f.frameRef.replace(/^frames\//, '');
      lines.push('  tl.add(function(){ setStageBackground(' + JSON.stringify(url) + ', ' + JSON.stringify(f.viewport || null) + '); }, ' + t.toFixed(3) + ');');
    }
  }

  // ---- 进度条 ----
  lines.push('  tl.to(".jse-progress > .bar", { width: "100%", duration: ' + dur.toFixed(3) + ', ease: "none" }, 0);');

  lines.push('  window.__timelines[' + JSON.stringify(id) + '] = tl;');
  // 用 JSON.stringify 把整条 log 信息一次性序列化成合法 JS 字符串字面量，避免
  // effects JSON 内的双引号撕裂外层 console.log("...") 引号导致 SyntaxError。
  const __logMsg = '[jse-replay] timeline registered (v0.6.0 ' + snapshotMode + '), frames=' + frames.length + ', hud=' + hud.length + ', flash=' + flash.length + ', rel=' + relation.length + ', cards=' + cards.length + ', effects=' + JSON.stringify(effects) + ', dur=' + dur.toFixed(3) + 's';
  lines.push('  console.log(' + JSON.stringify(__logMsg) + ');');
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
