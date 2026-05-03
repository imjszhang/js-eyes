// bridges/_dom-actions.js
// ---------------------------------------------------------------------------
// 共享 DOM 交互工具（v3.7.0 dom-first）
//
// 通过 // @@include ./_dom-actions.js 注入到使用 DOM 路径的 bridge IIFE 内。
// 所有函数挂在 IIFE 闭包，命名以 __jseDom 前缀避免污染。每步交互通过
// window.__jse_visual.emit 写出 dom_* 事件，被 drainVisualEvents 回收，
// 离线 hyperframes timeline 据此渲染鼠标轨迹 / 打字机 / 点击波纹 / 滚动 / 等待。
//
// 提供：
//   __jseDomEmit(type, payload)
//   __jseDomEmitNavigateIntent(toUrl)         先 emit dom_navigate 再让 caller location.assign
//   __jseDomQuery(selectors, root)            优先返回可见节点
//   __jseDomQueryAll(selectors, root)
//   __jseDomLocate(selectors, opts)           emit dom_locate
//   __jseDomWaitFor(selectors, opts)          polling 等元素出现 + emit dom_wait
//   __jseDomScrollIntoView(target, opts)      emit dom_scroll
//   __jseDomClick(target, opts)               emit dom_locate/hover/click + 真实点击
//   __jseDomType(target, text, opts)          emit dom_type 逐字 + 触发 input/change
//   __jseDomExtract(selectors, mapFn, opts)   emit dom_extract + 返回 items
//
// dom_* 事件 schema 见 packages/visual-bridge-kit/bridge/visual.common.js 顶部注释。
//
// 错误码：
//   dom_not_found        selectors 全部 fallback 失败
//   dom_timeout          waitFor 超过 timeoutMs 仍不满足 count
//   dom_extract_failed   queryAll 没结果
//   dom_navigation_required  bridge 业务层主动报，由 runTool 接管 navigate + retry
// ---------------------------------------------------------------------------

function __jseDomEmit(type, payload){
  try {
    if (typeof window === 'undefined') return;
    if (!window.__jse_visual || typeof window.__jse_visual.emit !== 'function') return;
    window.__jse_visual.emit(Object.assign({ type: String(type), ts: Date.now() }, payload || {}));
  } catch (_) {}
}

function __jseDomEmitNavigateIntent(toUrl){
  let from = '';
  try { from = location.href; } catch (_) {}
  __jseDomEmit('dom_navigate', { from, to: String(toUrl || '') });
}

function __jseDomSleep(ms){
  return new Promise(function(r){ setTimeout(r, Math.max(0, Number(ms) || 0)); });
}

function __jseDomRect(el){
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  try {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  } catch (_) { return null; }
}

function __jseDomVisible(el){
  if (!el || typeof el.getBoundingClientRect !== 'function') return false;
  let r = null;
  try { r = el.getBoundingClientRect(); } catch (_) { return false; }
  if (!r || r.width <= 0 || r.height <= 0) return false;
  try {
    const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)) return false;
  } catch (_) {}
  return true;
}

function __jseDomQuery(selectors, root){
  const r = root || document;
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (let i = 0; i < list.length; i++) {
    const sel = list[i];
    if (!sel) continue;
    let nodes = null;
    try { nodes = r.querySelectorAll(sel); } catch (_) { continue; }
    if (!nodes || !nodes.length) continue;
    for (let j = 0; j < nodes.length; j++) {
      if (__jseDomVisible(nodes[j])) return { el: nodes[j], selector: sel, fallbackIndex: i };
    }
    return { el: nodes[0], selector: sel, fallbackIndex: i };
  }
  return null;
}

function __jseDomQueryAll(selectors, root){
  const r = root || document;
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (let i = 0; i < list.length; i++) {
    const sel = list[i];
    if (!sel) continue;
    let nodes = null;
    try { nodes = r.querySelectorAll(sel); } catch (_) { continue; }
    if (nodes && nodes.length) {
      return { nodes: Array.prototype.slice.call(nodes), selector: sel, fallbackIndex: i };
    }
  }
  return null;
}

async function __jseDomLocate(selectors, opts){
  opts = opts || {};
  const found = __jseDomQuery(selectors);
  if (!found) {
    if (!opts.optional) {
      __jseDomEmit('dom_locate', {
        selector: Array.isArray(selectors) ? selectors[0] : String(selectors || ''),
        miss: true,
      });
    }
    return null;
  }
  const rect = __jseDomRect(found.el);
  __jseDomEmit('dom_locate', { selector: found.selector, rect });
  return found;
}

async function __jseDomWaitFor(selectors, opts){
  opts = opts || {};
  const timeoutMs = Math.max(50, Math.min(60000, Number(opts.timeoutMs) || 8000));
  const minCount = Math.max(1, Number(opts.count) || 1);
  const intervalMs = Math.max(50, Math.min(2000, Number(opts.intervalMs) || 200));
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const got = __jseDomQueryAll(selectors);
    if (got && got.nodes.length >= minCount) {
      const rect = __jseDomRect(got.nodes[0]);
      __jseDomEmit('dom_wait', {
        selector: got.selector,
        count: got.nodes.length,
        duration: Date.now() - t0,
        rect,
      });
      return {
        ok: true,
        selector: got.selector,
        count: got.nodes.length,
        durationMs: Date.now() - t0,
        nodes: got.nodes,
      };
    }
    last = got;
    await __jseDomSleep(intervalMs);
  }
  const fallbackSel = Array.isArray(selectors) ? selectors[0] : String(selectors || '');
  __jseDomEmit('dom_wait', {
    selector: fallbackSel,
    count: last ? last.nodes.length : 0,
    duration: Date.now() - t0,
    timeout: true,
  });
  return {
    ok: false,
    error: 'dom_timeout',
    selector: fallbackSel,
    durationMs: Date.now() - t0,
    count: last ? last.nodes.length : 0,
  };
}

async function __jseDomScrollIntoView(targetOrSelectors, opts){
  opts = opts || {};
  let el = null;
  let selector = null;
  if (targetOrSelectors && targetOrSelectors.nodeType === 1) {
    el = targetOrSelectors;
  } else {
    const found = __jseDomQuery(targetOrSelectors);
    if (found) { el = found.el; selector = found.selector; }
  }
  if (!el) return { ok: false, error: 'dom_not_found' };
  let fromY = 0; try { fromY = window.scrollY || 0; } catch (_) {}
  try { el.scrollIntoView({ block: opts.block || 'center', behavior: opts.behavior || 'smooth' }); } catch (_) {}
  const settleMs = Number(opts.settleMs) > 0 ? Number(opts.settleMs) : 320;
  await __jseDomSleep(settleMs);
  let toY = 0; try { toY = window.scrollY || 0; } catch (_) {}
  __jseDomEmit('dom_scroll', { selector, fromY, toY, duration: settleMs });
  return { ok: true, selector, fromY, toY };
}

async function __jseDomClick(targetOrSelectors, opts){
  opts = opts || {};
  let el = null;
  let selector = null;
  if (targetOrSelectors && targetOrSelectors.nodeType === 1) {
    el = targetOrSelectors;
  } else {
    const found = __jseDomQuery(targetOrSelectors);
    if (found) { el = found.el; selector = found.selector; }
  }
  if (!el) return { ok: false, error: 'dom_not_found' };
  await __jseDomScrollIntoView(el, { settleMs: opts.scrollSettleMs || 180 });
  const rect = __jseDomRect(el);
  __jseDomEmit('dom_locate', { selector, rect });
  const hoverMs = Number(opts.hoverMs) >= 0 ? Number(opts.hoverMs) : 100;
  if (hoverMs > 0) await __jseDomSleep(hoverMs);
  __jseDomEmit('dom_hover', { selector, rect, duration: hoverMs });
  __jseDomEmit('dom_click', { selector, rect });
  try {
    if (window.__jse_visual && typeof window.__jse_visual.flashElement === 'function') {
      window.__jse_visual.flashElement(el, { tone: opts.tone || 'success', durationMs: opts.flashMs || 320 });
    }
  } catch (_) {}
  let didNavigate = false;
  try {
    if (el.tagName === 'A' && el.href && opts.useHref !== false) {
      let same = false;
      try { same = new URL(el.href).origin === location.origin; } catch (_) { same = false; }
      if (same) {
        try { location.assign(el.href); didNavigate = true; } catch (_) {}
      }
    }
    if (!didNavigate) {
      const r2 = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const cx = r2 ? Math.round(r2.left + r2.width / 2) : 0;
      const cy = r2 ? Math.round(r2.top + r2.height / 2) : 0;
      const o = { bubbles: true, cancelable: true, view: window, button: 0, clientX: cx, clientY: cy };
      try { el.dispatchEvent(new MouseEvent('mousedown', o)); } catch (_) {}
      try { el.dispatchEvent(new MouseEvent('mouseup', o)); } catch (_) {}
      try { el.dispatchEvent(new MouseEvent('click', o)); } catch (_) {}
      try { if (typeof el.click === 'function') el.click(); } catch (_) {}
    }
  } catch (_) {}
  if ((opts.afterMs || 0) > 0) await __jseDomSleep(opts.afterMs);
  return { ok: true, selector, rect, navigated: didNavigate };
}

async function __jseDomType(targetOrSelectors, text, opts){
  opts = opts || {};
  let el = null;
  let selector = null;
  if (targetOrSelectors && targetOrSelectors.nodeType === 1) {
    el = targetOrSelectors;
  } else {
    const found = __jseDomQuery(targetOrSelectors);
    if (found) { el = found.el; selector = found.selector; }
  }
  if (!el) return { ok: false, error: 'dom_not_found' };
  const txt = String(text == null ? '' : text);
  const perCharMs = Math.max(0, Math.min(500, Number(opts.perCharMs) || 60));
  try { el.focus(); } catch (_) {}
  const tag = (el.tagName || '').toLowerCase();
  const isInput = tag === 'input' || tag === 'textarea';
  let setter = null;
  try {
    const proto = tag === 'input' ? HTMLInputElement.prototype
                : tag === 'textarea' ? HTMLTextAreaElement.prototype
                : null;
    if (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && typeof desc.set === 'function') setter = desc.set;
    }
  } catch (_) {}
  let cur = '';
  if (isInput) {
    if (opts.clear !== false) {
      try { setter ? setter.call(el, '') : (el.value = ''); } catch (_) {}
    } else {
      cur = String(el.value || '');
    }
  } else if (el.isContentEditable) {
    if (opts.clear !== false) try { el.textContent = ''; } catch (_) {}
    cur = String(el.textContent || '');
  }
  const rect = __jseDomRect(el);
  __jseDomEmit('dom_locate', { selector, rect });
  for (let i = 0; i < txt.length; i++) {
    const ch = txt.charAt(i);
    cur = cur + ch;
    if (isInput) {
      try { setter ? setter.call(el, cur) : (el.value = cur); } catch (_) {}
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' }));
      } catch (_) {
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
      }
    } else if (el.isContentEditable) {
      try { el.textContent = cur; } catch (_) {}
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' }));
      } catch (_) {}
    }
    __jseDomEmit('dom_type', { selector, char: ch, cursor: cur.length, text: cur, rect });
    if (perCharMs > 0) await __jseDomSleep(perCharMs);
  }
  try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
  if (opts.submit) {
    const ko = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
    try { el.dispatchEvent(new KeyboardEvent('keydown', ko)); } catch (_) {}
    try { el.dispatchEvent(new KeyboardEvent('keypress', ko)); } catch (_) {}
    try { el.dispatchEvent(new KeyboardEvent('keyup', ko)); } catch (_) {}
    let form = null;
    try { form = el.form || el.closest && el.closest('form'); } catch (_) {}
    if (form) {
      try { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } catch (_) {}
      try { if (typeof form.submit === 'function') form.submit(); } catch (_) {}
    }
  }
  __jseDomEmit('dom_typed', { selector, text: cur, length: cur.length });
  return { ok: true, selector, value: cur };
}

function __jseDomExtract(selectors, mapFn, opts){
  opts = opts || {};
  const got = __jseDomQueryAll(selectors);
  if (!got) {
    __jseDomEmit('dom_extract', {
      selector: Array.isArray(selectors) ? selectors[0] : String(selectors || ''),
      count: 0,
      sample: [],
      miss: true,
    });
    return { ok: false, error: 'dom_extract_failed', count: 0, items: [] };
  }
  const items = [];
  const max = Math.max(1, Math.min(500, Number(opts.limit) || got.nodes.length));
  for (let i = 0; i < got.nodes.length && i < max; i++) {
    try {
      const out = (typeof mapFn === 'function') ? mapFn(got.nodes[i], i) : got.nodes[i];
      if (out != null) items.push(out);
    } catch (_) {}
  }
  const sample = items.slice(0, Math.min(items.length, 3));
  __jseDomEmit('dom_extract', { selector: got.selector, count: items.length, sample });
  return { ok: true, selector: got.selector, count: items.length, items };
}
