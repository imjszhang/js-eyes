// bridges/_visual-browser.js
// ---------------------------------------------------------------------------
// 通用浏览器场景的 anchor resolver，覆盖 @js-eyes/visual-bridge-kit 默认实现。
// 由 wrapInjectCall 在 visual.common.js 之后注入，作为 IIFE 立即执行。
//
// 输入 spec 可能是：
//   - CSS selector 字符串：'.foo > .bar'
//   - XPath 字符串：'//button[@type="submit"]' 或 '(//div[@class="x"])[2]'
//   - 完整 URL 字符串：'https://example.com/path' （兜底匹配 a[href=...]）
//   - 对象：
//       { selector, index? }
//       { xpath, index? }
//       { text, selector?, index? }   按 innerText 包含匹配
//       { url }                       匹配 a[href]
//
// 解析失败必须返回 null，让调度层自动降级 HUD-only。
// ---------------------------------------------------------------------------

;(function installBrowserVisualAnchor(){
  if (typeof window === 'undefined' || !window || !window.document) return;
  if (!window.__jse_visual || !window.__jse_visual.setSiteAnchorResolver) return;

  function safeQS(sel){
    if (typeof sel !== 'string' || !sel) return null;
    try { return document.querySelector(sel); } catch (_) { return null; }
  }

  function safeQSAll(sel){
    if (typeof sel !== 'string' || !sel) return [];
    try { return Array.from(document.querySelectorAll(sel)); } catch (_) { return []; }
  }

  function isXPath(spec){
    if (typeof spec !== 'string') return false;
    return spec.startsWith('//') || spec.startsWith('(//') || spec.startsWith('./');
  }

  function evalXPath(expr, index){
    try {
      const r = document.evaluate(
        expr, document, null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
      );
      const idx = typeof index === 'number' && index >= 0 ? index : 0;
      const node = r.snapshotItem(idx);
      return node && node.nodeType === 1 ? node : null;
    } catch (_) { return null; }
  }

  function resolveByText(text, selector, index){
    if (typeof text !== 'string' || !text) return null;
    const root = selector ? safeQSAll(selector) : safeQSAll('*');
    const idx = typeof index === 'number' && index >= 0 ? index : 0;
    let hits = 0;
    for (let i = 0; i < root.length; i++) {
      const el = root[i];
      const inner = (el.innerText || el.textContent || '').trim();
      if (!inner) continue;
      if (inner.indexOf(text) === -1) continue;
      if (hits === idx) return el;
      hits++;
    }
    return null;
  }

  function resolveByUrl(url){
    if (typeof url !== 'string' || !url) return null;
    let abs;
    try { abs = new URL(url, location.href).href; } catch (_) { abs = url; }
    let exact = null;
    try {
      exact = document.querySelector('a[href="' + abs.replace(/"/g, '\\"') + '"]');
    } catch (_) {}
    if (exact) return exact;
    const all = safeQSAll('a[href]');
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      try {
        if (a.href === abs || a.getAttribute('href') === url) return a;
      } catch (_) {}
    }
    return null;
  }

  function resolveByCss(sel, index){
    if (typeof sel !== 'string' || !sel) return null;
    const all = safeQSAll(sel);
    if (!all.length) return null;
    const idx = typeof index === 'number' && index >= 0 ? index : 0;
    return all[idx] || null;
  }

  function resolveAnchor(spec){
    if (!spec) return null;

    if (typeof spec === 'string') {
      if (isXPath(spec)) {
        const x = evalXPath(spec, 0);
        if (x) return x;
      }
      if (/^https?:\/\//i.test(spec)) {
        const u = resolveByUrl(spec);
        if (u) return u;
      }
      const css = resolveByCss(spec, 0);
      if (css) return css;
      return null;
    }

    if (typeof spec === 'object') {
      if (typeof spec.xpath === 'string' && spec.xpath) {
        return evalXPath(spec.xpath, spec.index);
      }
      if (typeof spec.text === 'string' && spec.text) {
        return resolveByText(spec.text, spec.selector || '', spec.index);
      }
      if (typeof spec.selector === 'string' && spec.selector) {
        return resolveByCss(spec.selector, spec.index);
      }
      if (typeof spec.url === 'string' && spec.url) {
        return resolveByUrl(spec.url);
      }
    }
    return null;
  }

  window.__jse_visual.setSiteAnchorResolver(resolveAnchor);
})();
