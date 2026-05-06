(() => {
  const VERSION = '0.1.0';
  // @@include common.js

  function articleTarget(args) {
    if (args && args.url) return new URL(args.url, location.href).toString();
    if (args && args.articleId) return `https://zhuanlan.zhihu.com/p/${encodeURIComponent(args.articleId)}`;
    return null;
  }

  const api = {
    __meta: { name: 'zhihu-article-bridge', version: VERSION },
    state() {
      const state = currentPageState();
      return { ok: true, data: Object.assign({}, state, { ready: state.ready && state.hasArticle }) };
    },
    dom_getArticle(args) {
      const target = articleTarget(args || {});
      if (target && location.href !== target && !/\/p\/\d+/.test(location.pathname)) {
        return { ok: false, error: 'dom_navigation_required', to: target, navMethod: 'navigateArticle', navArgs: args || {} };
      }
      return extractArticle(args || {});
    },
    getArticle(args) {
      return this.dom_getArticle(args || {});
    },
    sessionState,
    navigateArticle(args) {
      const target = articleTarget(args || {});
      if (!target) return { ok: false, error: 'missing_target' };
      return navigateTo(target);
    },
    navigateHome() {
      return navigateTo('https://www.zhihu.com/');
    },
  };
  window.__jse_zhihu_article__ = api;
  return { ok: true, version: VERSION };
})()
