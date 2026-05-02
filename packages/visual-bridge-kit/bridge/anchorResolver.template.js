// @js-eyes/visual-bridge-kit · bridge/anchorResolver.template.js
// ---------------------------------------------------------------------------
// 复制此文件到 skill 的 bridges/_visual-<site>.js，按站点 DOM 改写 resolveAnchor。
// 这份模板只是"占位 + 注释"，本身被 @@include 也不会副作用：
//   - 它只在 window.__jse_visual 已经存在时才覆盖 resolveAnchor。
//   - 如果你只想要 HUD-only 的反馈，完全可以不引入本文件。
//
// 典型用法（@@include 出现在 bridge IIFE 内部）：
//
//   ;(() => {
//     const VERSION = '...';
//     // @@include @js-eyes/visual-bridge-kit/bridge/visual.common.js
//     // @@include ./_visual-<site>.js
//     ...
//   })();
//
// _visual-<site>.js 应：
//   1. 检测 site 前端类型（reddit shreddit / old；x web / m；…）
//   2. 把 fullname / id / url 反查成 DOM element
//   3. 失败返回 null（调度层会自动降级 HUD-only）
// ---------------------------------------------------------------------------

;(function installSiteAnchorResolver(){
  if (typeof window === 'undefined' || !window || !window.document) return;
  if (!window.__jse_visual || !window.__jse_visual.setSiteAnchorResolver) return;

  function resolveAnchor(spec){
    if (!spec) return null;

    // TODO: 根据具体站点实现，比如
    //   if (typeof spec === 'string' && /^t3_/.test(spec)) {
    //     return document.querySelector('shreddit-post[id="' + spec + '"]')
    //         || document.getElementById('thing_' + spec);
    //   }

    if (typeof spec === 'string') {
      try { return document.querySelector(spec); } catch (_) { return null; }
    }
    if (typeof spec === 'object' && spec.selector) {
      try { return document.querySelector(spec.selector); } catch (_) { return null; }
    }
    return null;
  }

  window.__jse_visual.setSiteAnchorResolver(resolveAnchor);
})();
