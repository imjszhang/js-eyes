// @js-eyes/visual-bridge-kit · bridge/visual.common.js
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
//   - config(opts)        运行期改 enabled / durationMs / detailLevel / mode / prefix / listStrideMs
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
// ---------------------------------------------------------------------------

(function installVisualBridgeKit(){
  if (typeof window === 'undefined' || !window || !window.document) return;
  if (window.__jse_visual && window.__jse_visual.__installed) return;

  const VERSION = '0.1.0';
  const EVENTS_BUFFER_LIMIT = 200;

  const VISUAL_DEFAULTS = {
    enabled: true,
    durationMs: 420,
    detailLevel: 'staged',  // 'compact' | 'staged'
    mode: 'auto',           // 'auto' | 'dom' | 'hud' | 'both'
    prefix: '__jse_visual_',
    listStrideMs: 90,
    zIndex: 2147483000,
    label: '',
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
    events: [],
    listenersInstalled: false,
  };

  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

  function normalizeDuration(ms, fallback){
    const base = typeof fallback === 'number' ? fallback : state.config.durationMs;
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return base;
    return clamp(Math.round(n), 120, 4000);
  }

  function normalizeDetailLevel(value, fallback){
    if (value === 'compact' || value === 'staged') return value;
    return fallback || state.config.detailLevel;
  }

  function normalizeMode(value, fallback){
    if (value === 'auto' || value === 'dom' || value === 'hud' || value === 'both' || value === 'off') return value;
    return fallback || state.config.mode;
  }

  function setConfig(opts){
    const next = Object.assign({}, state.config);
    if (!opts || typeof opts !== 'object') {
      state.config = next;
      return Object.assign({}, next);
    }
    if (typeof opts.enabled === 'boolean') next.enabled = opts.enabled;
    if (opts.durationMs != null) next.durationMs = normalizeDuration(opts.durationMs, next.durationMs);
    if (opts.detailLevel != null) next.detailLevel = normalizeDetailLevel(opts.detailLevel, next.detailLevel);
    if (opts.mode != null) next.mode = normalizeMode(opts.mode, next.mode);
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
    state.config = next;
    return Object.assign({}, next);
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
        '#' + id.hud + '{' +
          'position:fixed;top:16px;right:16px;max-width:360px;padding:10px 14px;' +
          'border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.22);' +
          'font:600 13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
          'white-space:pre-wrap;pointer-events:none;z-index:' + (state.config.zIndex + 1) + ';' +
        '}' +
        '@keyframes ' + id.pulse + '{' +
          '0%{transform:scale(.985);opacity:.2}' +
          '35%{transform:scale(1.003);opacity:1}' +
          '100%{transform:scale(1);opacity:1}' +
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

  function emit(evt){
    if (!evt || typeof evt !== 'object') return;
    const e = Object.assign({ ts: Date.now() }, evt);
    state.events.push(e);
    if (state.events.length > EVENTS_BUFFER_LIMIT) {
      state.events.splice(0, state.events.length - EVENTS_BUFFER_LIMIT);
    }
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

  function removeLater(el, durationMs){
    if (!el) return;
    const ms = normalizeDuration(durationMs);
    window.setTimeout(() => { if (el && el.parentNode) el.remove(); }, ms);
  }

  function flashElement(el, opts){
    if (!state.config.enabled) return false;
    if (state.config.mode === 'hud' || state.config.mode === 'off') return false;
    if (!el) return false;
    let rect; try { rect = el.getBoundingClientRect(); } catch (_) { rect = null; }
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    if (!isInViewport(rect)) return false;
    const o = opts || {};
    const layer = ensureRoot();
    const id = ids();
    const spec = toneSpec(o.tone || 'info');
    const inset = typeof o.inset === 'number' ? o.inset : 0;
    const box = document.createElement('div');
    box.className = id.box;
    box.style.left   = Math.max(4, rect.left - inset) + 'px';
    box.style.top    = Math.max(4, rect.top  - inset) + 'px';
    box.style.width  = Math.max(18, rect.width  + inset * 2) + 'px';
    box.style.height = Math.max(18, rect.height + inset * 2) + 'px';
    box.style.border = '2px solid ' + spec.border;
    box.style.background = spec.fill;
    box.style.boxShadow = '0 0 0 1px ' + spec.border + '33, 0 12px 28px ' + spec.border + '22';
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
    removeLater(box, o.durationMs);
    emit({ type: 'flash', tone: o.tone || 'info', label: o.label || '', anchor: o.anchor || null });
    return true;
  }

  function flashRelation(fromEl, toEl, opts){
    if (!state.config.enabled) return false;
    if (state.config.mode === 'hud' || state.config.mode === 'off') return false;
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
    removeLater(group, o.durationMs);
    emit({ type: 'relation', tone: o.tone || 'info', label: o.label || '' });
    return true;
  }

  function showHud(opts){
    if (!state.config.enabled) return false;
    if (state.config.mode === 'dom' || state.config.mode === 'off') return false;
    const o = opts || {};
    ensureRoot();
    const id = ids();
    let hud = document.getElementById(id.hud);
    if (!hud) {
      hud = document.createElement('div');
      hud.id = id.hud;
      (document.body || document.documentElement).appendChild(hud);
    }
    const spec = toneSpec(o.status || o.tone || 'info');
    const lines = [];
    if (o.action) lines.push(String(o.action));
    if (o.target) lines.push(String(o.target));
    if (o.detail) lines.push(String(o.detail));
    hud.textContent = lines.join('\n');
    hud.style.border = '1px solid ' + spec.border;
    hud.style.background = spec.fill.replace(/0\.\d+\)$/, '0.92)');
    hud.style.color = spec.pill;
    if (state.hudTimer) clearTimeout(state.hudTimer);
    const dur = normalizeDuration(o.durationMs, Math.max(900, state.config.durationMs * 2));
    state.hudTimer = window.setTimeout(() => {
      if (hud && hud.parentNode) hud.remove();
      state.hudTimer = null;
    }, dur);
    emit({ type: 'hud', tone: o.status || o.tone || 'info', action: o.action || '', target: o.target || '', detail: o.detail || '' });
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

  function cleanup(){
    const id = ids();
    const layer = document.getElementById(id.layer);
    if (layer) {
      Array.from(layer.querySelectorAll('.' + id.box)).forEach((el) => el.remove());
      Array.from(layer.querySelectorAll('.' + id.relation)).forEach((el) => el.remove());
    }
    const hud = document.getElementById(id.hud);
    if (hud) hud.remove();
    if (state.hudTimer) {
      clearTimeout(state.hudTimer);
      state.hudTimer = null;
    }
  }

  // ---- 调度层 hook：Node 端 wrapCallApi 在 callApi 前后调用 ----
  // hint = { kind, label, anchor, target, detail, tone, items, relate }
  function before(hint){
    if (!state.config.enabled) return false;
    const h = hint || {};
    const tone = h.tone || 'pending';
    const action = h.label || h.action || h.toolName || '';
    let element = null;
    if (h.anchor && (state.config.mode === 'auto' || state.config.mode === 'dom' || state.config.mode === 'both')) {
      element = api.resolveAnchor(h.anchor);
    }
    if (element) {
      flashElement(element, { tone, label: action, anchor: h.anchor });
    }
    showHud({
      action,
      target: h.target || (h.anchor ? String(h.anchor) : ''),
      detail: h.detail || '',
      status: tone,
    });
    emit({ type: 'before', kind: h.kind || 'global', label: action, anchor: h.anchor || null });
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
    if (h.anchor && (state.config.mode === 'auto' || state.config.mode === 'dom' || state.config.mode === 'both')) {
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
    emit({ type: 'after', kind: h.kind || 'global', label: action, ok: s.ok !== false, count: Array.isArray(s.items) ? s.items.length : null });
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

  function defaultStaggerFlashItems(opts){
    const o = opts || {};
    const items = Array.isArray(o.items) ? o.items.slice(0, 12) : [];
    const stride = typeof o.stride === 'number' ? Math.max(0, o.stride) : state.config.listStrideMs;
    const tone = o.tone || 'info';
    items.forEach((item, idx) => {
      window.setTimeout(() => {
        const el = api.resolveAnchor(item);
        if (el) flashElement(el, { tone, label: o.label || '' , anchor: item });
      }, idx * stride);
    });
    return items.length;
  }

  function installRouterListeners(){
    if (state.listenersInstalled) return;
    state.listenersInstalled = true;
    try {
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function(){
        try { cleanup(); } catch (_) {}
        return origPush.apply(this, arguments);
      };
      history.replaceState = function(){
        try { cleanup(); } catch (_) {}
        return origReplace.apply(this, arguments);
      };
    } catch (_) {}
    try {
      window.addEventListener('popstate', () => { try { cleanup(); } catch (_) {} });
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
    emit,
    drainEvents,
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
  };

  window.__jse_visual = api;
  installRouterListeners();
})();
