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
  // v0.5.0 snapshot mode: PNG/JPEG 帧序列。effects 默认 none，所有 dom_* 渲染都
  // 用 effects gate 包住。snapshotMode = 'snapshot' 时 stage 显示背景图，
  // 'template' 时退回卡片渲染（v0.4.0 行为）。
  const frames = Array.isArray(info.frames) ? info.frames : [];
  const snapshotMode = info.snapshotMode === 'snapshot' ? 'snapshot' : 'template';
  const effectsCfg = info.effects && typeof info.effects === 'object' ? info.effects : {};
  const effects = {
    cursor: !!effectsCfg.cursor,
    typing: !!effectsCfg.typing,
    click: !!effectsCfg.click,
    ripple: !!effectsCfg.ripple,
    spinner: !!effectsCfg.spinner,
    scroll: !!effectsCfg.scroll,
    shell: !!effectsCfg.shell,
    // v0.5.1：hud / flash 也纳入 effects gate，snapshot 默认全 false
    hud: !!effectsCfg.hud,
    flash: !!effectsCfg.flash,
  };
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

  // ---- HUD（v0.5.1 起受 effects.hud 控制；snapshot 模式默认关）----
  // hud DOM 在 effects.hud=false 时不渲染（buildHtml 已跳过 renderHudClips），这里
  // 只为了避免给不存在的 #hud-i 写 GSAP tween 而再做一次 gate（GSAP 找不到 selector
  // 不会报错，但能省一堆空 tween）。
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

  // ---- Flash：class 切换（v0.5.1 起受 effects.flash 控制）----
  // 同 anchorId 多次 flash 时各自独立 add/remove；动画由 CSS keyframes 跑。
  // snapshot 模式 cards 已 display:none，flash class 加上去也看不见，但仍会跑无谓的
  // querySelector，这里 gate 掉一并停掉性能损耗。
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

  // ---- v0.5.0 snapshot mode：#stage 背景图 cross-fade ----
  // 双缓冲：cur + next 两层 div，next 先 fade-in 再 cur 切图 next fade-out。
  // 关键：page-load 时立即把第一帧种到 .jse-frame-img-cur，避免 timeline play
  // 延迟（800ms + tl.first.tStart）期间的"黑屏"；timeline 重播 (repeat -1) 时
  // 也用 first frame 复位，体感连续。
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
    // 立即把第一帧种到 cur 图层（同步 inline，timeline 还没 play 时已可见）
    lines.push('  if (__frameCur) {');
    lines.push('    __frameCur.style.backgroundImage = "url(\'" + ' + JSON.stringify(firstUrl) + ' + "\')";');
    if (firstViewport) {
      lines.push('    if (__stage) {');
      lines.push('      __stage.style.setProperty("--snapshot-vp-w", ' + JSON.stringify(String(firstViewport.cssW || firstViewport.w || 1280)) + ' + "px");');
      lines.push('      __stage.style.setProperty("--snapshot-aspect", ' + JSON.stringify((firstViewport.cssW || firstViewport.w || 1280) + '/' + (firstViewport.cssH || firstViewport.h || 720)) + ');');
      lines.push('    }');
    }
    lines.push('  }');
    // 时间轴 t=0 时也把 cur 复位到第一帧（loop 回到 0 时不残留上一帧）
    lines.push('  tl.set("#stage .jse-frame-img-next", { opacity: 0 }, 0);');
    for (const f of frames) {
      if (!f.frameRef) continue;
      const t = Math.max(0, Number(f.tStart) || 0);
      const url = 'frames/' + f.frameRef.replace(/^frames\//, '');
      lines.push('  tl.add(function(){ setStageBackground(' + JSON.stringify(url) + ', ' + JSON.stringify(f.viewport || null) + '); }, ' + t.toFixed(3) + ');');
    }
  }

  // ---- v0.4.0 DOM-first 渲染（cursor / click ripple / typing / wait spinner） ----
  // composition viewport 与原始 reddit 视口尺寸不一致；rect 直接当 px 用，外层 clamp。
  // cursor 节点延迟创建（首次 dom_locate 时挂到 body）。
  // v0.5.0：所有合成视觉 (cursor/typing/click/ripple/spinner/scroll) 用 effects gate
  // 包住，默认 none 保证 snapshot 不冗余；--effects=all 等价 v0.4.0 行为。
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

    // dom_locate / dom_hover：移动 cursor（effects.cursor）
    if (effects.cursor) {
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
    }
    // dom_click：移动 cursor (effects.cursor) + 撒波纹 (effects.ripple || effects.click)
    if (effects.cursor || effects.ripple || effects.click) {
      for (const ev of domClick) {
        if (!ev.rect) continue;
        const t = Math.max(0, ev.tStart || 0);
        const parts = [];
        if (effects.cursor) parts.push('moveCursor(' + JSON.stringify(ev.rect) + ', 0.18)');
        if (effects.ripple || effects.click) parts.push('spawnRipple(' + JSON.stringify(ev.rect) + ')');
        if (parts.length === 0) continue;
        lines.push('  tl.add(function(){ ' + parts.join('; ') + '; }, ' + t.toFixed(3) + ');');
      }
    }
    // dom_typing：在 [data-shell-search] 上逐字 set value（effects.typing）
    if (effects.typing) {
      for (const run of domTyping) {
        if (!run || !run.text) continue;
        const text = String(run.text);
        const len = text.length;
        const runDur = Math.max(0.4, Number(run.duration) || (len * 0.06));
        const perChar = runDur / Math.max(1, len);
        const startT = Math.max(0, Number(run.tStart) || 0);
        if (run.rect && effects.cursor) {
          lines.push('  tl.add(function(){ moveCursor(' + JSON.stringify(run.rect) + ', 0.24); }, ' + startT.toFixed(3) + ');');
        }
        for (let i = 0; i < len; i++) {
          const slice = text.slice(0, i + 1);
          const tt = startT + i * perChar;
          lines.push('  tl.add(function(){ setShellSearchValue(' + JSON.stringify(slice) + '); }, ' + tt.toFixed(3) + ');');
        }
      }
    }
    // dom_wait：spinner mount/unmount (effects.spinner)
    if (effects.spinner) {
      for (const w of domWait) {
        if (!w.rect || w.timeout) continue;
        const tIn = Math.max(0, Number(w.tStart) || 0);
        const dW = Math.max(0.2, Math.min(2.0, Number(w.duration) || 0.4));
        lines.push('  tl.add(function(){ spawnSpinner(' + JSON.stringify(w.rect) + ', ' + JSON.stringify(w.id) + '); }, ' + tIn.toFixed(3) + ');');
        lines.push('  tl.add(function(){ removeSpinner(' + JSON.stringify(w.id) + '); }, ' + (tIn + dW).toFixed(3) + ');');
      }
    }
    // dom_scroll：用 stage 容器轻微 translateY 表达滚动 (effects.scroll)
    if (effects.scroll) {
      for (const sc of domScroll) {
        if (sc.fromY === sc.toY) continue;
        const t = Math.max(0, Number(sc.tStart) || 0);
        const d = Math.max(0.1, Math.min(1.5, Number(sc.duration) || 0.3));
        const dy = Math.max(-40, Math.min(40, ((Number(sc.toY) || 0) - (Number(sc.fromY) || 0)) / 40));
        lines.push('  tl.to("#stage", { y: "+=' + (-dy).toFixed(2) + '", duration: ' + d.toFixed(3) + ', ease: "power1.inOut" }, ' + t.toFixed(3) + ');');
        lines.push('  tl.to("#stage", { y: 0, duration: 0.32, ease: "power1.out" }, ' + (t + d).toFixed(3) + ');');
      }
    }
  }

  // ---- 进度条 ----
  lines.push('  tl.to(".jse-progress > .bar", { width: "100%", duration: ' + dur.toFixed(3) + ', ease: "none" }, 0);');

  lines.push('  window.__timelines[' + JSON.stringify(id) + '] = tl;');
  // 用 JSON.stringify 把整条 log 信息一次性序列化成合法 JS 字符串字面量，避免
  // effects JSON 内的双引号撕裂外层 console.log("...") 引号导致 SyntaxError。
  const __logMsg = '[jse-replay] timeline registered (v0.5.0 snapshot/' + snapshotMode + '), frames=' + frames.length + ', hud=' + hud.length + ', flash=' + flash.length + ', rel=' + relation.length + ', cards=' + cards.length + ', dom={loc:' + domLocate.length + ',clk:' + domClick.length + ',type:' + domTyping.length + ',wait:' + domWait.length + ',scr:' + domScroll.length + '}, effects=' + JSON.stringify(effects) + ', dur=' + dur.toFixed(3) + 's';
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
