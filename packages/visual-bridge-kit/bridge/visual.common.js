// @js-eyes/visual-bridge-kit · bridge/visual.common.js
// ---------------------------------------------------------------------------
// !!! 视觉常量同步声明 !!!
// TONE_MAP / 关键尺寸（hud / box / badge）与下列两份保持视觉一致：
//   - node/visualPalette.js          (Node 端共享 tone, 给离线消费者)
//   - styles/visual-runtime.css      (类名 + data-tone + 变量, 给离线转译器渲染)
// 修改 TONE_MAP 时请同步上述两份；颜色由 [data-tone] 在 CSS 中驱动，
// bridge 这里仍用内联 style 是因为运行时注入的是带 prefix 的 ID 选择器，
// 与离线静态 composition 用的 class+attr 选择器在结构上不同，但视觉等价。
// ---------------------------------------------------------------------------
// 这是一份纯浏览器代码，由 makeBridgeExpander 注入到 bridge IIFE 体内：
//
//   (() => {
//     const VERSION = '...';
//     // @@include @js-eyes/visual-bridge-kit/bridge/visual.common.js
//     ...
//   })();
//
// 副作用：在 page world 创建 window.__jse_visual 单例（幂等）。
// 单例之上挂：
//   - config(opts)        运行期改 enabled / durationMs / detailLevel / hud / flash / prefix / listStrideMs (v0.6.0+ 不再有 mode)
//   - getConfig()
//   - flashElement(el, o)
//   - flashRelation(from, to, o)
//   - showHud(o)
//   - announceStage(o)
//   - cleanup()
//   - resolveAnchor(spec)  默认 null，由站点 _visual-<site>.js 覆盖
//   - staggerFlashItems(o) 默认 noop，由站点 _visual-<site>.js 覆盖
//   - before(hint)         调度层 hook
//   - after(hint, summary) 调度层 hook
//   - drainEvents()
//   - emit(evt)
//   - events               ring buffer
//   - VERSION
//
// 调用方约定：
//   - 业务 bridge 不直接调 window.__jse_visual，由 Node 端 wrapCallApi 触发；
//   - 站点 _visual-<site>.js 可以覆盖 resolveAnchor / staggerFlashItems。
//
// 事件 schema（emit 是 free-form，下列为约定字段，translator 据此渲染）：
//
//   ── 视觉反馈类（post-2.7.0 主链路）──
//   { type: 'flash',  tone, label, anchor }                        语义 flash（被 hyperframes addClassByAnchor）
//   { type: 'before', kind, label, args, ... }                     wrapCallApi 前置
//   { type: 'after',  kind, summary, payload, ok, ... }            wrapCallApi 后置
//
//   ── DOM-first 类（v3.7.0+，由 skills/js-reddit-ops-skill/bridges/_dom-actions.js emit）──
//   { type: 'dom_locate',   selector, rect:{x,y,w,h} }             鼠标定位某元素
//   { type: 'dom_hover',    selector, rect, duration }             鼠标悬停（cursor 短停）
//   { type: 'dom_click',    selector, rect }                       触发点击 + 波纹
//   { type: 'dom_type',     selector, char, cursor, text, rect }   typing 一帧（per char）
//   { type: 'dom_typed',    selector, text, length }               typing 完成
//   { type: 'dom_scroll',   selector, fromY, toY, duration }       页面/容器滚动
//   { type: 'dom_wait',     selector, count, duration, timeout? }  等待元素出现 / 超时
//   { type: 'dom_extract',  selector, count, sample }              抓取列表（count 含义为成功 map 项数）
//   { type: 'dom_navigate', from, to }                             导航意图（实际 location.assign 由 caller 触发）
//
//   ── snapshot 类（v0.5.0+，由 skill runTool + visual-bridge-kit makeFrameWriter emit）──
//   { type: 'frame',        ts, frameRef:'frames/<ts>.jpg',
//                            viewport:{w,h,dpr}, when:'after'|'pre-nav'|'post-nav' }
//                                                                    PNG/JPEG 截图落盘成功，hyperframes 用作 #stage 背景
//
// emit 实现是 free-form：任何新增 type 仅需要 hyperframes 端 timeline.js + timelineScript.js 知晓即可，
// bridge / kit 主链路无须改动。
// ---------------------------------------------------------------------------

(function installVisualBridgeKit(){
  if (typeof window === 'undefined' || !window || !window.document) return;

  // v0.5.0 snapshot mode 重新启用 viewport probe：emit/frame/before/after 仍不强制
  // 注入 viewport（DOM 测量产物），但额外暴露 __jse_visual.viewport() 给 Node 端
  // wrapCallApi / makeFrameWriter 在截图前后 query 视口尺寸，写到 frame event 的
  // viewport 字段，让 hyperframes setStageBackground 设置 aspect-ratio。
  //
  // v0.7.0: 引入 overlay 三档生命周期（flash / linger / pinned）+ 重写列表 stagger
  // 为「规划→批量调度→可选呼吸」三阶段（不再每条 item 各自 setTimeout 触发独立
  // scrollIntoView，避免互抢页面位置）。详见 plan: visual-pinned-stagger-rewrite。
  const VERSION = '0.7.0';

  // 幂等保护：相同 VERSION 已注入则复用；老版本 / 不同 VERSION 强制重装，
  // 避免 Firefox 长 tab 跨会话缓存了 0.2.x bridge 而仍写 viewport / rect 字段。
  if (window.__jse_visual && window.__jse_visual.__installed) {
    if (window.__jse_visual.VERSION === VERSION) return;
    try { if (typeof window.__jse_visual.cleanup === 'function') window.__jse_visual.cleanup(); } catch (_) {}
    try { delete window.__jse_visual; } catch (_) { window.__jse_visual = undefined; }
  }
  const EVENTS_BUFFER_LIMIT = 200;

  // v0.6.0 BREAKING：旧 `mode: 'auto'|'dom'|'hud'|'both'|'off'` 已拆成两个正交布尔位 +
  // 顶层 `enabled` 总开关。映射：
  //   auto / both → hud=true,  flash=true
  //   dom         → hud=false, flash=true
  //   hud         → hud=true,  flash=false
  //   off         → enabled=false (等价 --no-visual)
  // CLI/Node 侧旧 --visual-mode 已硬切，传入会进 deprecatedFlags 并被忽略。
  const VISUAL_DEFAULTS = {
    enabled: true,
    durationMs: 420,        // v0.7+ alias of flashMs（pending 一闪），保留兼容字段名
    flashMs: 420,           // v0.7: lifetime='flash' 的 timeout（pending tone）
    lingerMs: 5000,         // v0.7: lifetime='linger' 的 timeout（success tone 默认）
    pinnedHold: 'next-call', // v0.7: 'next-call' | 'manual'，pinned 何时被清
    errorAsPinned: true,    // v0.7: error tone 是否自动升级到 pinned
    scrollSettleMs: 80,     // v0.7: stagger phase B 滚动后等 layout settle
    staggerFadeIn: false,   // v0.7: phase C 呼吸感（CSS animation-delay）
    detailLevel: 'staged',  // 'compact' | 'staged'
    hud: true,              // 是否显示右上角 HUD 卡片（含 announceStage / before / after 的 hud）
    flash: true,            // 是否在元素上画 flash overlay / flashRelation 连线
    prefix: '__jse_visual_',
    listStrideMs: 90,       // v0.7: 仅在 staggerFadeIn=true 时作为 CSS animation-delay 步进
    zIndex: 2147483000,
    label: '',
    redactSelectors: [],
  };

  const TONE_MAP = {
    pending: { border: '#faad14', fill: 'rgba(250, 173, 20, 0.16)', pill: '#ad6800', text: '#fffbe6' },
    success: { border: '#52c41a', fill: 'rgba(82, 196, 26, 0.14)',  pill: '#237804', text: '#f6ffed' },
    danger:  { border: '#ff4d4f', fill: 'rgba(255, 77, 79, 0.14)',  pill: '#a8071a', text: '#fff1f0' },
    error:   { border: '#ff4d4f', fill: 'rgba(255, 77, 79, 0.14)',  pill: '#a8071a', text: '#fff1f0' },
    info:    { border: '#1677ff', fill: 'rgba(22, 119, 255, 0.14)', pill: '#0958d9', text: '#f0f5ff' },
    warn:    { border: '#faad14', fill: 'rgba(250, 173, 20, 0.16)', pill: '#ad6800', text: '#fffbe6' },
  };

  const STAGE_COPY = {
    locate: '已定位',
    execute: '执行中',
    respond: '页面已响应',
    verify: '已验证',
  };

  const state = {
    config: Object.assign({}, VISUAL_DEFAULTS),
    hudTimer: null,
    /** v0.7: 当前 HUD 节点的 lifetime（'flash' | 'linger' | 'pinned'），cleanup 用 */
    hudLifetime: 'flash',
    events: [],
    listenersInstalled: false,
    /** 异步 stagger flash 全部画完前，JPEG 截图不应触发；由 bumpCaptureSettleRelative 推进 */
    captureSettleDeadlineMs: 0,
    /**
     * v0.7: 已挂在 layer 上的 overlay 元素登记表，每条 { el, lifetime, timer? }。
     * pinned 元素 timer=null（不自动消失）；linger 的 timer 在 hover 时被清掉、
     * leave 时重新挂；cleanup({scope}) 按 lifetime 区别处理。
     */
    activeOverlays: [],
  };

  /**
   * 由 defaultStaggerFlashItems / 站点 setSiteStaggerFlashItems 调用：
   *   在「当前时刻」之后至少再等 deltaMs 毫秒，才允许 captureVisibleTab。
   * Node 端 wrapCallApi 会在 hooks.captureFrame 之前 await awaitCaptureSettle()。
   */
  function bumpCaptureSettleRelative(deltaMs){
    const add = Math.max(0, Math.round(Number(deltaMs) || 0));
    if (!add) return;
    const edge = Date.now() + add;
    state.captureSettleDeadlineMs = Math.max(state.captureSettleDeadlineMs || 0, edge);
  }

  /**
   * Promise：等到 captureSettleDeadlineMs（相对「当前时刻」的 scheduling edge）。
   * 无待定 stagger 时仍会 requestAnimationFrame + 0ms，给同步 HUD/outline 一帧绘制时间。
   */
  function awaitCaptureSettle(){
    const deadline = state.captureSettleDeadlineMs || 0;
    state.captureSettleDeadlineMs = 0;
    const ms = Math.max(0, deadline - Date.now());
    return new Promise(function(resolve){
      try {
        requestAnimationFrame(function(){
          setTimeout(resolve, ms);
        });
      } catch (_) {
        setTimeout(resolve, ms);
      }
    });
  }

  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

  function normalizeDuration(ms, fallback){
    const base = typeof fallback === 'number' ? fallback : state.config.flashMs;
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return base;
    // 上限放宽到 60s 以容纳 lifetime='linger'（默认 5s，可配 60s 上限）；
    // flash tone 自身仍由 caller 用 flashMs (默认 420ms) 喂进来，并不会自动跑到上限。
    return clamp(Math.round(n), 120, 60000);
  }

  // v0.7: 给 lifetime 派生 timeout（单位 ms，pinned 返回 0 表示"不挂 setTimeout"）
  function lifetimeMs(lifetime){
    const cfg = state.config;
    if (lifetime === 'pinned') return 0;
    if (lifetime === 'linger') return Math.max(0, Number(cfg.lingerMs) || 0);
    return Math.max(0, Number(cfg.flashMs) || 0);
  }

  // v0.7: 由 tone 派生 lifetime；errorAsPinned=false 时 error 降级 linger
  function lifetimeFromTone(tone, opts){
    if (opts && (opts.lifetime === 'flash' || opts.lifetime === 'linger' || opts.lifetime === 'pinned')) {
      return opts.lifetime;
    }
    if (tone === 'error' || tone === 'danger') {
      return state.config.errorAsPinned ? 'pinned' : 'linger';
    }
    if (tone === 'success' || tone === 'info' || tone === 'warn') return 'linger';
    return 'flash';
  }

  function normalizeDetailLevel(value, fallback){
    if (value === 'compact' || value === 'staged') return value;
    return fallback || state.config.detailLevel;
  }

  function setConfig(opts){
    const next = Object.assign({}, state.config);
    if (!opts || typeof opts !== 'object') {
      state.config = next;
      return Object.assign({}, next);
    }
    if (typeof opts.enabled === 'boolean') next.enabled = opts.enabled;
    if (opts.durationMs != null) {
      const d = normalizeDuration(opts.durationMs, next.flashMs);
      next.durationMs = d;
      next.flashMs = d;
    }
    if (opts.flashMs != null) {
      const d = normalizeDuration(opts.flashMs, next.flashMs);
      next.flashMs = d;
      next.durationMs = d;
    }
    if (opts.lingerMs != null) {
      const n = Number(opts.lingerMs);
      if (Number.isFinite(n) && n >= 0) next.lingerMs = clamp(Math.round(n), 0, 60000);
    }
    if (opts.pinnedHold === 'next-call' || opts.pinnedHold === 'manual') {
      next.pinnedHold = opts.pinnedHold;
    }
    if (typeof opts.errorAsPinned === 'boolean') next.errorAsPinned = opts.errorAsPinned;
    if (opts.scrollSettleMs != null) {
      const n = Number(opts.scrollSettleMs);
      if (Number.isFinite(n) && n >= 0) next.scrollSettleMs = clamp(Math.round(n), 0, 2000);
    }
    if (typeof opts.staggerFadeIn === 'boolean') next.staggerFadeIn = opts.staggerFadeIn;
    if (opts.detailLevel != null) next.detailLevel = normalizeDetailLevel(opts.detailLevel, next.detailLevel);
    if (typeof opts.hud === 'boolean') next.hud = opts.hud;
    if (typeof opts.flash === 'boolean') next.flash = opts.flash;
    if (typeof opts.prefix === 'string' && opts.prefix.length > 0 && opts.prefix.length < 64) next.prefix = opts.prefix;
    if (opts.listStrideMs != null) {
      const n = Number(opts.listStrideMs);
      if (Number.isFinite(n) && n >= 0) next.listStrideMs = clamp(Math.round(n), 0, 1000);
    }
    if (opts.zIndex != null) {
      const n = Number(opts.zIndex);
      if (Number.isFinite(n) && n > 0) next.zIndex = Math.round(n);
    }
    if (typeof opts.label === 'string') next.label = opts.label;
    if (Array.isArray(opts.redactSelectors)) {
      next.redactSelectors = opts.redactSelectors.filter((s) => typeof s === 'string' && s.length > 0).slice(0, 64);
    }
    state.config = next;
    return Object.assign({}, next);
  }

  function isRectRedacted(rect){
    const sels = state.config.redactSelectors;
    if (!Array.isArray(sels) || sels.length === 0 || !rect) return false;
    let nodes = [];
    try {
      for (const sel of sels) {
        try {
          const list = document.querySelectorAll(sel);
          for (const n of list) nodes.push(n);
        } catch (_) {}
      }
    } catch (_) { return false; }
    if (!nodes.length) return false;
    for (const n of nodes) {
      let r;
      try { r = n.getBoundingClientRect(); } catch (_) { continue; }
      if (!r || r.width <= 0 || r.height <= 0) continue;
      const ix = Math.max(rect.x, r.left);
      const iy = Math.max(rect.y, r.top);
      const ax = Math.min(rect.x + rect.w, r.right);
      const ay = Math.min(rect.y + rect.h, r.bottom);
      if (ix < ax && iy < ay) return true;
    }
    return false;
  }

  function getConfig(){ return Object.assign({}, state.config); }

  function ids(){
    const p = state.config.prefix;
    return {
      style: p + 'style',
      layer: p + 'layer',
      hud:   p + 'hud',
      box:   p + 'box',
      relation: p + 'relation',
      line:  p + 'line',
      dot:   p + 'dot',
      badge: p + 'badge',
      pulse: p + 'pulse',
      close: p + 'close',
      fadein: p + 'fadein',
    };
  }

  function isCompact(){ return state.config.detailLevel === 'compact'; }
  function isStaged(){ return state.config.detailLevel !== 'compact'; }

  function ensureRoot(){
    const id = ids();
    let style = document.getElementById(id.style);
    if (!style) {
      style = document.createElement('style');
      style.id = id.style;
      style.textContent =
        '#' + id.layer + '{' +
          'position:fixed;inset:0;pointer-events:none;z-index:' + state.config.zIndex + ';overflow:visible;' +
        '}' +
        '.' + id.box + '{' +
          'position:fixed;box-sizing:border-box;border-radius:8px;' +
          'animation:' + id.pulse + ' .55s ease-out 1;' +
        '}' +
        // v0.7: pinned overlay 接收鼠标事件以支持 hover 延长 + × 关闭
        '.' + id.box + '[data-lifetime="pinned"], .' + id.box + '[data-lifetime="linger"]{' +
          'pointer-events:auto;' +
        '}' +
        '.' + id.box + '[data-fadein="1"]{' +
          'animation:' + id.pulse + ' .55s ease-out 1, ' + id.fadein + ' .35s ease-out var(--' + id.fadein + '-delay,0ms) 1 both;' +
        '}' +
        '.' + id.relation + '{' +
          'position:fixed;inset:0;' +
          'animation:' + id.pulse + ' .55s ease-out 1;' +
        '}' +
        '.' + id.line + '{' +
          'position:absolute;height:2px;transform-origin:left center;' +
          'box-shadow:0 0 0 1px currentColor, 0 8px 24px currentColor;opacity:.9;' +
        '}' +
        '.' + id.dot + '{' +
          'position:absolute;width:10px;height:10px;border-radius:999px;' +
          'transform:translate(-50%, -50%);box-shadow:0 0 0 2px rgba(255,255,255,.65);' +
        '}' +
        '.' + id.badge + '{' +
          'position:absolute;left:0;top:-28px;max-width:280px;padding:4px 10px;border-radius:999px;' +
          'font:600 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
          'letter-spacing:.01em;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;' +
          'box-shadow:0 8px 24px rgba(0,0,0,.18);' +
        '}' +
        // v0.7: pinned overlay 右上角 × 关闭按钮
        '.' + id.close + '{' +
          'position:absolute;top:-10px;right:-10px;width:22px;height:22px;border-radius:999px;' +
          'background:#fff;color:#222;border:1px solid rgba(0,0,0,.25);' +
          'font:700 14px/20px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
          'text-align:center;cursor:pointer;pointer-events:auto;' +
          'box-shadow:0 4px 12px rgba(0,0,0,.18);user-select:none;' +
        '}' +
        '#' + id.hud + '{' +
          'position:fixed;top:16px;right:16px;max-width:360px;padding:10px 14px;' +
          'border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.22);' +
          'font:600 13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
          'white-space:pre-wrap;z-index:' + (state.config.zIndex + 1) + ';' +
          'pointer-events:none;' +
        '}' +
        '#' + id.hud + '[data-lifetime="linger"], #' + id.hud + '[data-lifetime="pinned"]{' +
          'pointer-events:auto;' +
        '}' +
        '#' + id.hud + ' .' + id.close + '{' +
          'top:6px;right:6px;' +
        '}' +
        '@keyframes ' + id.pulse + '{' +
          '0%{transform:scale(.985);opacity:.2}' +
          '35%{transform:scale(1.003);opacity:1}' +
          '100%{transform:scale(1);opacity:1}' +
        '}' +
        '@keyframes ' + id.fadein + '{' +
          '0%{opacity:0}' +
          '100%{opacity:1}' +
        '}';
      (document.head || document.documentElement).appendChild(style);
    }
    let layer = document.getElementById(id.layer);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = id.layer;
      layer.style.pointerEvents = 'none';
      (document.body || document.documentElement).appendChild(layer);
    }
    return layer;
  }

  function toneSpec(tone){ return TONE_MAP[tone] || TONE_MAP.info; }

  // post-2.7.0 architecture pivot：viewportSnapshot / rectSnapshot 已无 mainline 调用方
  // （emit 主链路不再注入 viewport / anchor.rect）。如要回到 PNG 模式抓 DOM 坐标，
  // 改去 dev/index.js 配 makeFrameWriter 即可，本文件保持 in-page 视觉反馈最小依赖。

  function emit(evt){
    if (!evt || typeof evt !== 'object') return;
    const e = Object.assign({ ts: Date.now() }, evt);
    // post-2.7.0：不再注入 viewport（DOM 测量产物，A 路线 translator 不消费）
    state.events.push(e);
    if (state.events.length > EVENTS_BUFFER_LIMIT) {
      state.events.splice(0, state.events.length - EVENTS_BUFFER_LIMIT);
    }
  }

  // v0.5.0: query 当前视口（CSS 像素 + dpr + scrollY），给 makeFrameWriter
  // / wrapCallApi 在截图前调用，附在 frame event 的 viewport 字段。
  function viewport(){
    let w = 0, h = 0, dpr = 1, scrollY = 0, scrollX = 0;
    try {
      w = Math.max(0, Math.round(window.innerWidth || document.documentElement.clientWidth || 0));
      h = Math.max(0, Math.round(window.innerHeight || document.documentElement.clientHeight || 0));
      dpr = Number(window.devicePixelRatio) || 1;
      scrollY = Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0));
      scrollX = Math.max(0, Math.round(window.scrollX || window.pageXOffset || 0));
    } catch (_) {}
    return { cssW: w, cssH: h, w, h, dpr, scrollY, scrollX };
  }

  function drainEvents(){
    const out = state.events.slice();
    state.events.length = 0;
    return out;
  }

  function isInViewport(rect){
    if (!rect) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (rect.bottom < 0 || rect.right < 0) return false;
    if (rect.top > vh || rect.left > vw) return false;
    return true;
  }

  function relationPoint(el, side){
    if (!el) return null;
    let rect; try { rect = el.getBoundingClientRect(); } catch (_) { rect = null; }
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    if (side === 'left')   return { x: rect.left,                       y: rect.top + rect.height / 2 };
    if (side === 'right')  return { x: rect.right,                      y: rect.top + rect.height / 2 };
    if (side === 'top')    return { x: rect.left + rect.width / 2,      y: rect.top };
    if (side === 'bottom') return { x: rect.left + rect.width / 2,      y: rect.bottom };
    return                       { x: rect.left + rect.width / 2,      y: rect.top + rect.height / 2 };
  }

  // v0.7: removeLater 升级为 lifetime-aware 版本
  //   - lifetime='flash'  : 老行为，setTimeout(remove, flashMs)
  //   - lifetime='linger' : setTimeout(remove, lingerMs)；hover 进入清 timer，hover 离开重挂
  //   - lifetime='pinned' : 不挂 timer，登记到 state.activeOverlays，由 cleanup({scope}) 主动清
  //   返回内部记录对象，调用方可读它的 .lifetime 字段。
  function removeLater(el, opts){
    if (!el) return null;
    const o = (opts && typeof opts === 'object') ? opts : { durationMs: opts };
    const lifetime = (o.lifetime === 'pinned' || o.lifetime === 'linger' || o.lifetime === 'flash')
      ? o.lifetime
      : 'flash';
    const baseMs = lifetimeMs(lifetime);
    const explicit = (o.durationMs != null) ? Number(o.durationMs) : null;
    const ms = (Number.isFinite(explicit) && explicit > 0)
      ? clamp(Math.round(explicit), 0, 60000)
      : baseMs;

    const record = { el: el, lifetime: lifetime, timer: null };
    state.activeOverlays.push(record);

    function detach(){
      const idx = state.activeOverlays.indexOf(record);
      if (idx >= 0) state.activeOverlays.splice(idx, 1);
      if (record.timer) { clearTimeout(record.timer); record.timer = null; }
      if (record.el && record.el.parentNode) record.el.remove();
    }
    record.dismiss = detach;

    if (lifetime !== 'pinned') {
      record.timer = window.setTimeout(detach, ms);
      // linger：鼠标悬停清 timer；离开重挂 —— 让用户能停下来看
      if (lifetime === 'linger') {
        try {
          el.addEventListener('mouseenter', function(){
            if (record.timer) { clearTimeout(record.timer); record.timer = null; }
          });
          el.addEventListener('mouseleave', function(){
            if (!record.timer) record.timer = window.setTimeout(detach, ms);
          });
        } catch (_) {}
      }
    }
    return record;
  }

  // v0.7: pinned 元素右上角 × 关闭按钮
  function attachCloseButton(host, record){
    if (!host || !record) return;
    const id = ids();
    const btn = document.createElement('div');
    btn.className = id.close;
    btn.textContent = '\u00d7';
    btn.title = 'dismiss';
    btn.addEventListener('click', function(ev){
      ev.stopPropagation();
      ev.preventDefault();
      try { record.dismiss && record.dismiss(); } catch (_) {}
    });
    host.appendChild(btn);
  }

  function flashElement(el, opts){
    if (!state.config.enabled) return false;
    if (!state.config.flash) return false;
    if (!el) return false;
    let rect; try { rect = el.getBoundingClientRect(); } catch (_) { rect = null; }
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    if (!isInViewport(rect)) return false;
    const o = opts || {};
    const tone = o.tone || 'info';
    const lifetime = lifetimeFromTone(tone, o);
    const layer = ensureRoot();
    const id = ids();
    const spec = toneSpec(tone);
    const inset = typeof o.inset === 'number' ? o.inset : 0;
    const box = document.createElement('div');
    box.className = id.box;
    box.setAttribute('data-tone', tone);
    box.setAttribute('data-lifetime', lifetime);
    box.style.left   = Math.max(4, rect.left - inset) + 'px';
    box.style.top    = Math.max(4, rect.top  - inset) + 'px';
    box.style.width  = Math.max(18, rect.width  + inset * 2) + 'px';
    box.style.height = Math.max(18, rect.height + inset * 2) + 'px';
    box.style.border = '2px solid ' + spec.border;
    box.style.background = spec.fill;
    box.style.boxShadow = '0 0 0 1px ' + spec.border + '33, 0 12px 28px ' + spec.border + '22';
    if (o.fadeInDelayMs != null && Number.isFinite(Number(o.fadeInDelayMs))) {
      box.setAttribute('data-fadein', '1');
      box.style.setProperty('--' + id.fadein + '-delay', Math.max(0, Math.round(Number(o.fadeInDelayMs))) + 'ms');
    }
    if (o.label) {
      const badge = document.createElement('div');
      badge.className = id.badge;
      badge.textContent = String(o.label);
      badge.style.background = spec.pill;
      badge.style.color = spec.text;
      const desiredTop = rect.top < 38 ? rect.height + 8 : -28;
      badge.style.top = desiredTop + 'px';
      box.appendChild(badge);
    }
    layer.appendChild(box);
    const record = removeLater(box, { lifetime: lifetime, durationMs: o.durationMs });
    if (lifetime === 'pinned' && record) attachCloseButton(box, record);
    // post-2.7.0：emit shape 不再带 anchor.rect（DOM 实测坐标只用于 in-page 视觉，
    // 不下发到 translator；A 路线翻译器按 hint.kind + payload 还原 HTML 卡片，flash
    // 通过 anchor 的 id 字段与 HTML data-anchor-id 绑定）。
    // v0.7: emit 增加 lifetime 字段，hyperframes / 老消费者忽略即可。
    const anchorOut = o.anchor ? Object.assign({}, typeof o.anchor === 'object' ? o.anchor : { spec: o.anchor }) : {};
    emit({ type: 'flash', tone: tone, label: o.label || '', anchor: anchorOut, lifetime: lifetime });
    return true;
  }

  function flashRelation(fromEl, toEl, opts){
    if (!state.config.enabled) return false;
    if (!state.config.flash) return false;
    if (!fromEl || !toEl) return false;
    if (!isStaged()) return false;
    const o = opts || {};
    const start = relationPoint(fromEl, o.fromSide || 'right');
    const end   = relationPoint(toEl,   o.toSide   || 'left');
    if (!start || !end) return false;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!Number.isFinite(len) || len < 24) return false;
    const layer = ensureRoot();
    const id = ids();
    const spec = toneSpec(o.tone || 'info');
    const group = document.createElement('div');
    group.className = id.relation;
    const line = document.createElement('div');
    line.className = id.line;
    line.style.left = start.x + 'px';
    line.style.top  = start.y + 'px';
    line.style.width = len + 'px';
    line.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
    line.style.color = spec.border;
    line.style.background = spec.border;
    group.appendChild(line);
    [start, end].forEach((pt) => {
      const dot = document.createElement('div');
      dot.className = id.dot;
      dot.style.left = pt.x + 'px';
      dot.style.top  = pt.y + 'px';
      dot.style.background = spec.border;
      group.appendChild(dot);
    });
    if (o.label) {
      const badge = document.createElement('div');
      badge.className = id.badge;
      badge.textContent = String(o.label);
      badge.style.background = spec.pill;
      badge.style.color = spec.text;
      badge.style.left = (start.x + dx / 2) + 'px';
      badge.style.top  = (start.y + dy / 2 - 34) + 'px';
      badge.style.transform = 'translateX(-50%)';
      group.appendChild(badge);
    }
    layer.appendChild(group);
    // v0.7: relation 永远走 flash lifetime（连线只是瞬时反馈，不需要 linger/pinned）
    removeLater(group, { lifetime: 'flash', durationMs: o.durationMs });
    // post-2.7.0：relation event 不再携带 from/to.rect（DOM 测量产物）。
    // anchor 的 spec/from/to 字段仍写出来供 translator 与 HTML data-anchor-id 绑定。
    emit({
      type: 'relation',
      tone: o.tone || 'info',
      label: o.label || '',
      relate: {
        from: { spec: o.fromAnchor || null, side: o.fromSide || 'right' },
        to:   { spec: o.toAnchor   || null, side: o.toSide   || 'left'  },
      },
    });
    return true;
  }

  function showHud(opts){
    if (!state.config.enabled) return false;
    if (!state.config.hud) return false;
    const o = opts || {};
    ensureRoot();
    const id = ids();
    const tone = o.status || o.tone || 'info';
    const lifetime = lifetimeFromTone(tone, o);
    let hud = document.getElementById(id.hud);
    if (!hud) {
      hud = document.createElement('div');
      hud.id = id.hud;
      (document.body || document.documentElement).appendChild(hud);
    }
    const spec = toneSpec(tone);
    // 清空旧内容（含上一次的 close button），重建 textContent
    while (hud.firstChild) hud.removeChild(hud.firstChild);
    const lines = [];
    if (o.action) lines.push(String(o.action));
    if (o.target) lines.push(String(o.target));
    if (o.detail) lines.push(String(o.detail));
    hud.appendChild(document.createTextNode(lines.join('\n')));
    hud.setAttribute('data-tone', tone);
    hud.setAttribute('data-lifetime', lifetime);
    hud.style.border = '1px solid ' + spec.border;
    hud.style.background = spec.fill.replace(/0\.\d+\)$/, '0.92)');
    hud.style.color = spec.pill;
    // 旧 timer 必须先清；HUD 是单例，不进 activeOverlays（lifetime 只用于决策定时器/pointerEvents）
    if (state.hudTimer) { clearTimeout(state.hudTimer); state.hudTimer = null; }
    state.hudLifetime = lifetime;
    if (lifetime === 'pinned') {
      // 给 pinned HUD 也挂个 × 关闭按钮
      const btn = document.createElement('div');
      btn.className = id.close;
      btn.textContent = '\u00d7';
      btn.title = 'dismiss';
      btn.addEventListener('click', function(ev){
        ev.stopPropagation(); ev.preventDefault();
        if (hud && hud.parentNode) hud.remove();
        state.hudLifetime = 'flash';
      });
      hud.appendChild(btn);
    } else {
      const dur = lifetimeMs(lifetime);
      const explicit = (o.durationMs != null) ? Number(o.durationMs) : null;
      const ms = (Number.isFinite(explicit) && explicit > 0)
        ? clamp(Math.round(explicit), 0, 60000)
        : dur;
      state.hudTimer = window.setTimeout(() => {
        if (hud && hud.parentNode) hud.remove();
        state.hudTimer = null;
        state.hudLifetime = 'flash';
      }, ms);
      // linger HUD：hover 暂停倒计时
      if (lifetime === 'linger') {
        try {
          hud.addEventListener('mouseenter', function(){
            if (state.hudTimer) { clearTimeout(state.hudTimer); state.hudTimer = null; }
          });
          hud.addEventListener('mouseleave', function(){
            if (!state.hudTimer && hud.parentNode) {
              state.hudTimer = window.setTimeout(() => {
                if (hud && hud.parentNode) hud.remove();
                state.hudTimer = null;
                state.hudLifetime = 'flash';
              }, ms);
            }
          });
        } catch (_) {}
      }
    }
    emit({ type: 'hud', tone: tone, action: o.action || '', target: o.target || '', detail: o.detail || '', lifetime: lifetime });
    return true;
  }

  function announceStage(opts){
    const o = opts || {};
    if (!state.config.enabled) return false;
    const stageBadge = STAGE_COPY[o.stage] || '';
    if (isCompact() && o.stage === 'locate') return false;
    if (o.element) {
      flashElement(o.element, {
        tone: o.tone || 'info',
        label: o.badge || stageBadge,
        durationMs: o.durationMs,
        inset: o.inset || 0,
        anchor: o.anchor || null,
      });
    }
    if (o.relation && o.relation.from && o.relation.to) {
      flashRelation(o.relation.from, o.relation.to, {
        tone: o.tone || 'info',
        label: o.relation.label || '',
        durationMs: o.durationMs,
        fromSide: o.relation.fromSide,
        toSide: o.relation.toSide,
      });
    }
    showHud({
      action: [o.action, isStaged() ? stageBadge : ''].filter(Boolean).join(' · '),
      target: o.target || '',
      detail: o.detail || '',
      status: o.tone || 'info',
      durationMs: o.durationMs,
    });
    return true;
  }

  // v0.7: cleanup({ scope }) 区分 lifetime
  //   scope='all'        : 强制清所有 overlay + HUD（路由切换/手动 dismiss/cleanup 时用）
  //   scope='non-pinned' : 清 flash + linger overlay；保留 pinned；HUD 仅 lifetime!=pinned 时清
  //                        before() 默认走这条 → 让 error pinned 能跨工具调用残留
  //   scope='flash'      : 仅清 flash overlay
  //   scope=undefined    : 老语义，等价 'all'（保持 router popstate 等老调用方行为）
  function cleanup(opts){
    const scope = (opts && typeof opts === 'object' && opts.scope)
      ? opts.scope
      : (typeof opts === 'string' ? opts : 'all');
    const id = ids();
    const layer = document.getElementById(id.layer);

    // 1. 清 activeOverlays 里 lifetime 命中 scope 的元素
    const keep = [];
    for (const rec of state.activeOverlays) {
      let drop = false;
      if (scope === 'all') drop = true;
      else if (scope === 'non-pinned') drop = (rec.lifetime !== 'pinned');
      else if (scope === 'flash') drop = (rec.lifetime === 'flash');
      else if (scope === rec.lifetime) drop = true;
      if (drop) {
        if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
        if (rec.el && rec.el.parentNode) rec.el.remove();
      } else {
        keep.push(rec);
      }
    }
    state.activeOverlays = keep;

    // 2. 兜底：layer 里残留的、不在 activeOverlays 的 box/relation 节点（极少发生，
    //    比如老路径直接 createElement 没走 removeLater；only 'all' / 'non-pinned' 兜）
    if (layer && (scope === 'all' || scope === 'non-pinned' || scope === 'flash')) {
      Array.from(layer.querySelectorAll('.' + id.box)).forEach((el) => {
        const lt = el.getAttribute('data-lifetime') || 'flash';
        if (scope === 'all') { el.remove(); return; }
        if (scope === 'non-pinned' && lt !== 'pinned') { el.remove(); return; }
        if (scope === 'flash' && lt === 'flash') { el.remove(); return; }
      });
      Array.from(layer.querySelectorAll('.' + id.relation)).forEach((el) => el.remove());
    }

    // 3. HUD：scope='all' 一定清；scope='non-pinned' 仅当 hudLifetime != pinned 时清
    const hud = document.getElementById(id.hud);
    if (hud) {
      const shouldClearHud = (scope === 'all')
        || (scope === 'non-pinned' && state.hudLifetime !== 'pinned')
        || (scope === 'flash' && state.hudLifetime === 'flash');
      if (shouldClearHud) {
        hud.remove();
        if (state.hudTimer) { clearTimeout(state.hudTimer); state.hudTimer = null; }
        state.hudLifetime = 'flash';
      }
    }

    if (scope === 'all') state.captureSettleDeadlineMs = 0;
  }

  // v0.7: 公共 API，强制清所有 overlay（含 pinned）+ HUD
  function dismissAll(){ cleanup({ scope: 'all' }); }

  // ---- 调度层 hook：Node 端 wrapCallApi 在 callApi 前后调用 ----
  // hint = { kind, label, anchor, target, detail, tone, items, relate }
  function before(hint){
    if (!state.config.enabled) return false;
    const h = hint || {};
    const tone = h.tone || 'pending';
    const action = h.label || h.action || h.toolName || '';
    // v0.7: 新工具调用开始时，按 pinnedHold 决定是否保留上一次的 pinned overlay
    //   - 'next-call'：清掉 pinned（这是"下一次调用"的语义边界）
    //   - 'manual'   ：保留 pinned，只清 non-pinned
    if (state.config.pinnedHold === 'next-call') {
      cleanup({ scope: 'all' });
    } else {
      cleanup({ scope: 'non-pinned' });
    }
    let element = null;
    if (h.anchor && state.config.flash) {
      element = api.resolveAnchor(h.anchor);
    }
    if (element) {
      // pending tone 自动派生 lifetime='flash'
      flashElement(element, { tone, label: action, anchor: h.anchor });
    }
    showHud({
      action,
      target: h.target || (h.anchor ? String(h.anchor) : ''),
      detail: h.detail || '',
      status: tone,
    });
    // post-2.7.0：before/after 不再带 anchor.rect。
    let beforeAnchor = null;
    if (h.anchor) {
      beforeAnchor = Object.assign({}, typeof h.anchor === 'object' ? h.anchor : { spec: h.anchor });
    }
    emit({ type: 'before', kind: h.kind || 'global', label: action, anchor: beforeAnchor });
    return true;
  }

  function after(hint, summary){
    if (!state.config.enabled) return false;
    const h = hint || {};
    const s = summary || {};
    const tone = s.ok === false ? 'error' : (s.ok === true ? 'success' : 'info');
    const action = h.label || h.action || h.toolName || '';
    const detail = s.detail || (s.ok === false ? (s.errorCode || 'failed') : '');
    let element = null;
    if (h.anchor && state.config.flash) {
      element = api.resolveAnchor(h.anchor);
    }
    if (element) {
      flashElement(element, { tone, label: action, anchor: h.anchor });
    }
    showHud({
      action,
      target: s.target || h.target || (h.anchor ? String(h.anchor) : ''),
      detail,
      status: tone,
    });
    if (h.kind === 'list' && Array.isArray(s.items) && s.items.length) {
      api.staggerFlashItems({ items: s.items, label: h.label || '', tone });
    }
    if (h.kind === 'tree' && Array.isArray(s.relate) && s.relate.length) {
      for (const r of s.relate) {
        const fromEl = api.resolveAnchor(r.from);
        const toEl   = api.resolveAnchor(r.to);
        if (fromEl && toEl) flashRelation(fromEl, toEl, { tone, label: r.label || '' });
      }
    }
    // post-2.7.0：after 不再带 anchor.rect；payload 由 Node 端 wrapCallApi 的
    // hooks.extractPayload 抽取后透传到 summary.payload，这里 emit 写到 event.payload。
    let afterAnchor = null;
    if (h.anchor) {
      afterAnchor = Object.assign({}, typeof h.anchor === 'object' ? h.anchor : { spec: h.anchor });
    }
    const payload = (s && typeof s.payload === 'object' && s.payload !== null) ? s.payload : null;
    emit({
      type: 'after',
      kind: h.kind || 'global',
      label: action,
      ok: s.ok !== false,
      count: Array.isArray(s.items) ? s.items.length : null,
      anchor: afterAnchor,
      payload,
    });
    return true;
  }

  // ---- 站点级覆盖点 ----
  // resolveAnchor(spec): 返回 DOM element 或 null。spec 可能是 fullname / selector / url / 自定义对象。
  // staggerFlashItems({ items, stride, label, tone }): 列表呼吸感，默认逐个 resolveAnchor 再 flash。
  function defaultResolveAnchor(spec){
    if (!spec) return null;
    if (typeof spec === 'string') {
      // 兜底：CSS selector
      try { return document.querySelector(spec); } catch (_) { return null; }
    }
    if (typeof spec === 'object' && spec.selector) {
      try { return document.querySelector(spec.selector); } catch (_) { return null; }
    }
    return null;
  }

  // v0.7: 列表 stagger 三阶段重写
  //   phase A (sync)  : 遍历 items，sync emit 全部语义 flash event 进 ring buffer
  //                     （后台 tab Firefox setTimeout 节流到 1Hz 也不漏 event），
  //                     同时 resolveAnchor + measure，得到 [{item, el, rect, inViewport}]。
  //   phase B (decide): 在视口内的 → 立即并发 flashElement（不 stagger，全部一帧画完）
  //                     视口外但 DOM 在的 → 选最近的一桶，一次 scrollIntoView（block:'center'）+
  //                     等 scrollSettleMs 让 layout settle，然后批量 flashElement
  //                     （不再每条 item 各自 setTimeout 触发独立 scrollIntoView，避免互抢）
  //   phase C (breathe, optional): 若 cfg.staggerFadeIn=true，给每个 box 加 CSS animation-delay
  //                     做纯 CSS 呼吸感，无 JS 时序漂移。
  //   注：item 命中不到 DOM（虚拟列表卸载）时只在 phase A emit 语义 event；
  //   离线 hyperframes 仍可完整回放，在线肉眼跳过即可。
  function defaultStaggerFlashItems(opts){
    const o = opts || {};
    const items = Array.isArray(o.items) ? o.items.slice(0, 12) : [];
    const tone = o.tone || 'info';
    const label = o.label || '';
    const cfg = state.config;
    const lifetime = lifetimeFromTone(tone, o);
    const fadeIn = !!cfg.staggerFadeIn;
    const fadeStride = (typeof o.stride === 'number') ? Math.max(0, o.stride) : cfg.listStrideMs;
    const scrollSettleMs = Math.max(0, Number(cfg.scrollSettleMs) || 0);

    if (!items.length) return 0;

    // ---- phase A：sync emit + measure ----
    // 离线 events.jsonl 总数 100% 准确（哪怕后台 tab 节流），在线 outline 由 phase B 异步画。
    const plan = [];
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    items.forEach(function(item){
      let el = null;
      try { el = api.resolveAnchor(item); } catch (_) { el = null; }
      let rect = null;
      let inViewport = false;
      let distance = Number.POSITIVE_INFINITY;
      if (el) {
        try { rect = el.getBoundingClientRect(); } catch (_) { rect = null; }
        if (rect && rect.width > 4 && rect.height > 4) {
          inViewport = (rect.top < vh - 80 && rect.bottom > 80);
          if (!inViewport) {
            // 距离视口中心的绝对距离，phase B 取最近的一桶滚一次
            const center = (rect.top + rect.bottom) / 2;
            distance = Math.abs(center - vh / 2);
          }
        }
      }
      // phase A: 同步 emit 语义 flash（不画 outline，仅入 ring buffer）
      const anchorObj = (item && typeof item === 'object')
        ? Object.assign({}, item)
        : { spec: String(item || '') };
      emit({ type: 'flash', tone: tone, label: label, anchor: anchorObj, lifetime: lifetime });

      plan.push({ item: item, el: el, rect: rect, inViewport: inViewport, distance: distance });
    });

    // ---- phase B：分桶画 outline ----
    let scheduled = 0;
    const inVPItems = plan.filter(function(p){ return p.el && p.inViewport; });
    const offVPItems = plan.filter(function(p){ return p.el && !p.inViewport; });

    function drawOne(p, idx){
      try {
        flashElement(p.el, {
          tone: tone,
          label: label,
          anchor: p.item,
          lifetime: lifetime,
          fadeInDelayMs: fadeIn ? (idx * fadeStride) : null,
        });
        scheduled++;
      } catch (_) {}
    }

    // B-1：在视口内的，立刻并发画（同一 tick 内全部 outline 入 layer，无互抢）
    inVPItems.forEach(function(p, i){ drawOne(p, i); });

    // B-2：视口外的，选距离最近的一桶（取首条），一次 scrollIntoView，等 settle 后批量画
    if (offVPItems.length) {
      offVPItems.sort(function(a, b){ return a.distance - b.distance; });
      const anchor = offVPItems[0];
      try {
        if (anchor.el && typeof anchor.el.scrollIntoView === 'function') {
          try { anchor.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); }
          catch (_) { try { anchor.el.scrollIntoView(true); } catch (__) {} }
        }
      } catch (_) {}
      window.setTimeout(function(){
        // 滚动后重新测量：把这桶里 still-visible 的全部画出来
        const baseIdx = inVPItems.length;
        const vh2 = window.innerHeight || document.documentElement.clientHeight || 0;
        offVPItems.forEach(function(p, i){
          let r = null;
          try { r = p.el.getBoundingClientRect(); } catch (_) { r = null; }
          if (r && r.width > 4 && r.height > 4 && r.top < vh2 - 40 && r.bottom > 40) {
            drawOne(p, baseIdx + i);
          }
        });
      }, scrollSettleMs);
    }

    // ---- 截屏窗口推迟 ----
    // 同步部分一帧画完；异步部分 = scrollSettleMs + 一次绘制 + flashMs 一半 + 兜底 80ms
    const dur = lifetimeMs(lifetime) || cfg.flashMs || 420;
    const settleEdge = (offVPItems.length ? scrollSettleMs : 0) + Math.floor(dur * 0.55) + 80;
    bumpCaptureSettleRelative(settleEdge);

    return plan.length;
  }

  function installRouterListeners(){
    if (state.listenersInstalled) return;
    state.listenersInstalled = true;
    try {
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function(){
        try { cleanup({ scope: 'all' }); } catch (_) {}
        return origPush.apply(this, arguments);
      };
      history.replaceState = function(){
        try { cleanup({ scope: 'all' }); } catch (_) {}
        return origReplace.apply(this, arguments);
      };
    } catch (_) {}
    try {
      window.addEventListener('popstate', () => { try { cleanup({ scope: 'all' }); } catch (_) {} });
    } catch (_) {}
  }

  const api = {
    __installed: true,
    VERSION,
    config: setConfig,
    getConfig,
    flashElement,
    flashRelation,
    showHud,
    announceStage,
    cleanup,
    dismissAll,
    emit,
    drainEvents,
    viewport,
    before,
    after,
    resolveAnchor: defaultResolveAnchor,
    staggerFlashItems: defaultStaggerFlashItems,
    events: state.events,
    setSiteAnchorResolver(fn){
      if (typeof fn === 'function') api.resolveAnchor = fn;
    },
    setSiteStaggerFlashItems(fn){
      if (typeof fn === 'function') api.staggerFlashItems = fn;
    },
    bumpCaptureSettleRelative,
    awaitCaptureSettle,
  };

  window.__jse_visual = api;
  installRouterListeners();
})();
