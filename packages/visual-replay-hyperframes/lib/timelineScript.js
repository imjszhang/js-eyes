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
  const dom = info.dom && typeof info.dom === 'object' ? info.dom : {};
  const domLocate = Array.isArray(dom.locate) ? dom.locate : [];
  const domHover = Array.isArray(dom.hover) ? dom.hover : [];
  const domClick = Array.isArray(dom.click) ? dom.click : [];
  const domTyping = Array.isArray(dom.typing) ? dom.typing : [];
  const domWait = Array.isArray(dom.wait) ? dom.wait : [];
  const domScroll = Array.isArray(dom.scroll) ? dom.scroll : [];
  const domNavigate = Array.isArray(dom.navigate) ? dom.navigate : [];
  const domEnabled = !!(domLocate.length || domHover.length || domClick.length
                       || domTyping.length || domWait.length
                       || domScroll.length || domNavigate.length);
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
  // PR 0.3.0 reddit page shell：active card 切换时同步 chrome 状态。
  // 读 [data-page-type] + [data-page-meta]，更新 topbar search input、leftnav
  // 当前 sub 高亮、leftnav 当前 feed 高亮。如果当前页面是 sub-list / sub-about
  // / search 在 sub 内，则 leftnav 对应 sub 高亮；否则只清 active class。
  lines.push('  var syncShellState = function(cardEl){');
  lines.push('    if (!cardEl) return;');
  lines.push('    var pageType = cardEl.getAttribute("data-page-type") || "";');
  lines.push('    var metaRaw = cardEl.getAttribute("data-page-meta") || "{}";');
  lines.push('    var meta = {};');
  lines.push('    try { meta = JSON.parse(metaRaw); } catch (_) { meta = {}; }');
  lines.push('    var search = $("[data-shell-search]");');
  lines.push('    if (search) {');
  lines.push('      if (pageType === "reddit_search" && meta.query) search.value = String(meta.query);');
  lines.push('      else search.value = "";');
  lines.push('    }');
  lines.push('    var subItems = $all("[data-shell-sub]");');
  lines.push('    for (var i = 0; i < subItems.length; i++) {');
  lines.push('      var sn = subItems[i].getAttribute("data-shell-sub") || "";');
  lines.push('      if (meta.sub && sn === meta.sub) subItems[i].classList.add("active");');
  lines.push('      else subItems[i].classList.remove("active");');
  lines.push('    }');
  lines.push('    var feedItems = $all("[data-shell-feed]");');
  lines.push('    for (var j = 0; j < feedItems.length; j++) {');
  lines.push('      var fn = feedItems[j].getAttribute("data-shell-feed") || "";');
  lines.push('      if (meta.feed && fn === meta.feed) feedItems[j].classList.add("active");');
  lines.push('      else feedItems[j].classList.remove("active");');
  lines.push('    }');
  lines.push('  };');
  lines.push('  // 暴露给外层 (debug / hyperframes 控制)');
  lines.push('  window.__jseSyncShellState = syncShellState;');
  lines.push('  // hyperframes 渲染要求确定性时长（不能 repeat: -1）。');
  lines.push('  // standalone 浏览器预览模式下 800ms 后通过 .repeat(-1) 打开循环。');
  lines.push('  var tl = g.timeline({ paused: true });');

  // ---- card 入场（每张卡片在 cards.tStart 时刻显示） ----
  for (const c of cards) {
    const tIn = Math.max(0, c.tStart || 0);
    lines.push('  tl.fromTo("#' + c.id + '", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.32, ease: "power2.out" }, ' + tIn.toFixed(3) + ');');
    // PR 0.3.0：每张卡入场同时刻同步 reddit shell（topbar 搜索框 / leftnav 高亮 / sort tabs 选中态）
    lines.push('  tl.add(function(){ syncShellState($("#' + c.id + '")); }, ' + tIn.toFixed(3) + ');');
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

  // ---- v0.4.0 DOM-first 渲染（cursor / click ripple / typing / wait spinner） ----
  // composition viewport 与原始 reddit 视口尺寸不一致；rect 直接当 px 用，外层 clamp。
  // cursor 节点延迟创建（首次 dom_locate 时挂到 body）。
  if (domEnabled) {
    lines.push('  var domCursor = document.getElementById("jse-dom-cursor");');
    lines.push('  if (!domCursor) {');
    lines.push('    domCursor = document.createElement("div");');
    lines.push('    domCursor.id = "jse-dom-cursor";');
    lines.push('    domCursor.className = "jse-cursor";');
    lines.push('    domCursor.style.opacity = "0";');
    lines.push('    document.body.appendChild(domCursor);');
    lines.push('  }');
    lines.push('  var moveCursor = function(rect, durSec){');
    lines.push('    if (!rect) return;');
    lines.push('    var vw = window.innerWidth || 1280;');
    lines.push('    var vh = window.innerHeight || 720;');
    lines.push('    var x = Math.max(8, Math.min(vw - 24, (Number(rect.x) || 0) + (Number(rect.w) || 0) / 2));');
    lines.push('    var y = Math.max(8, Math.min(vh - 24, (Number(rect.y) || 0) + (Number(rect.h) || 0) / 2));');
    lines.push('    g.to(domCursor, { left: x, top: y, opacity: 1, duration: durSec || 0.32, ease: "power2.out" });');
    lines.push('  };');
    lines.push('  var spawnRipple = function(rect){');
    lines.push('    if (!rect) return;');
    lines.push('    var vw = window.innerWidth || 1280;');
    lines.push('    var vh = window.innerHeight || 720;');
    lines.push('    var x = Math.max(8, Math.min(vw - 8, (Number(rect.x) || 0) + (Number(rect.w) || 0) / 2));');
    lines.push('    var y = Math.max(8, Math.min(vh - 8, (Number(rect.y) || 0) + (Number(rect.h) || 0) / 2));');
    lines.push('    var rip = document.createElement("div");');
    lines.push('    rip.className = "jse-click-ripple";');
    lines.push('    rip.style.left = x + "px";');
    lines.push('    rip.style.top = y + "px";');
    lines.push('    document.body.appendChild(rip);');
    lines.push('    setTimeout(function(){ try { rip.parentNode && rip.parentNode.removeChild(rip); } catch (_) {} }, 720);');
    lines.push('  };');
    lines.push('  var setShellSearchValue = function(val){');
    lines.push('    var s = $("[data-shell-search]"); if (s) { try { s.value = String(val == null ? "" : val); } catch (_) {} }');
    lines.push('  };');
    lines.push('  var spawnSpinner = function(rect, idStr){');
    lines.push('    if (!rect) return;');
    lines.push('    var x = (Number(rect.x) || 0) + (Number(rect.w) || 0) / 2;');
    lines.push('    var y = (Number(rect.y) || 0) + (Number(rect.h) || 0) / 2;');
    lines.push('    var sp = document.createElement("div");');
    lines.push('    sp.className = "jse-spinner";');
    lines.push('    sp.setAttribute("data-jse-spinner-id", idStr);');
    lines.push('    sp.style.left = x + "px"; sp.style.top = y + "px";');
    lines.push('    document.body.appendChild(sp);');
    lines.push('  };');
    lines.push('  var removeSpinner = function(idStr){');
    lines.push('    var sp = document.querySelector(\'[data-jse-spinner-id="\' + idStr + \'"]\');');
    lines.push('    if (sp && sp.parentNode) sp.parentNode.removeChild(sp);');
    lines.push('  };');

    // dom_locate / dom_hover：移动 cursor
    for (const ev of domLocate) {
      if (!ev.rect || ev.miss) continue;
      const t = Math.max(0, ev.tStart || 0);
      lines.push('  tl.add(function(){ moveCursor(' + JSON.stringify(ev.rect) + ', 0.28); }, ' + t.toFixed(3) + ');');
    }
    for (const ev of domHover) {
      if (!ev.rect) continue;
      const t = Math.max(0, ev.tStart || 0);
      lines.push('  tl.add(function(){ moveCursor(' + JSON.stringify(ev.rect) + ', 0.18); }, ' + t.toFixed(3) + ');');
    }
    // dom_click：移动 cursor + 撒波纹
    for (const ev of domClick) {
      if (!ev.rect) continue;
      const t = Math.max(0, ev.tStart || 0);
      lines.push('  tl.add(function(){ moveCursor(' + JSON.stringify(ev.rect) + ', 0.18); spawnRipple(' + JSON.stringify(ev.rect) + '); }, ' + t.toFixed(3) + ');');
    }
    // dom_typing：在 [data-shell-search] 上逐字 set value（最直观；selector 不必匹配真实 anchor）
    for (const run of domTyping) {
      if (!run || !run.text) continue;
      const text = String(run.text);
      const len = text.length;
      const runDur = Math.max(0.4, Number(run.duration) || (len * 0.06));
      const perChar = runDur / Math.max(1, len);
      const startT = Math.max(0, Number(run.tStart) || 0);
      // cursor 也跟到 search 框（如果有 rect）
      if (run.rect) {
        lines.push('  tl.add(function(){ moveCursor(' + JSON.stringify(run.rect) + ', 0.24); }, ' + startT.toFixed(3) + ');');
      }
      for (let i = 0; i < len; i++) {
        const slice = text.slice(0, i + 1);
        const tt = startT + i * perChar;
        lines.push('  tl.add(function(){ setShellSearchValue(' + JSON.stringify(slice) + '); }, ' + tt.toFixed(3) + ');');
      }
    }
    // dom_wait：spinner mount/unmount
    for (const w of domWait) {
      if (!w.rect || w.timeout) continue;
      const tIn = Math.max(0, Number(w.tStart) || 0);
      const dW = Math.max(0.2, Math.min(2.0, Number(w.duration) || 0.4));
      lines.push('  tl.add(function(){ spawnSpinner(' + JSON.stringify(w.rect) + ', ' + JSON.stringify(w.id) + '); }, ' + tIn.toFixed(3) + ');');
      lines.push('  tl.add(function(){ removeSpinner(' + JSON.stringify(w.id) + '); }, ' + (tIn + dW).toFixed(3) + ');');
    }
    // dom_scroll：用 stage 容器轻微 translateY 表达滚动（仅当 viewport 有 stage 元素）
    for (const sc of domScroll) {
      if (sc.fromY === sc.toY) continue;
      const t = Math.max(0, Number(sc.tStart) || 0);
      const d = Math.max(0.1, Math.min(1.5, Number(sc.duration) || 0.3));
      const dy = Math.max(-40, Math.min(40, ((Number(sc.toY) || 0) - (Number(sc.fromY) || 0)) / 40));
      lines.push('  tl.to("#stage", { y: "+=' + (-dy).toFixed(2) + '", duration: ' + d.toFixed(3) + ', ease: "power1.inOut" }, ' + t.toFixed(3) + ');');
      lines.push('  tl.to("#stage", { y: 0, duration: 0.32, ease: "power1.out" }, ' + (t + d).toFixed(3) + ');');
    }
  }

  // ---- 进度条 ----
  lines.push('  tl.to(".jse-progress > .bar", { width: "100%", duration: ' + dur.toFixed(3) + ', ease: "none" }, 0);');

  lines.push('  window.__timelines[' + JSON.stringify(id) + '] = tl;');
  lines.push('  console.log("[jse-replay] timeline registered (post-2.7.0 HTML pivot + v0.4.0 dom-first), hud=' + hud.length + ', flash=' + flash.length + ', rel=' + relation.length + ', cards=' + cards.length + ', dom={loc:' + domLocate.length + ',clk:' + domClick.length + ',type:' + domTyping.length + ',wait:' + domWait.length + ',scr:' + domScroll.length + '}, dur=' + dur.toFixed(3) + 's");');
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
