(() => {
  const VERSION = '0.1.2';
  // @@include common.js

  function searchTarget(args) {
    if (!args || !args.keyword) return 'https://www.zhihu.com/search';
    const url = new URL('https://www.zhihu.com/search');
    url.searchParams.set('q', args.keyword);
    if (args.type) url.searchParams.set('type', args.type);
    return url.toString();
  }

  const api = {
    __meta: { name: 'zhihu-search-bridge', version: VERSION },
    state() {
      const state = currentPageState();
      return { ok: true, data: Object.assign({}, state, { ready: state.ready && state.hasSearch }) };
    },
    dom_search(args) {
      const target = searchTarget(args || {});
      if (target && location.pathname.indexOf('/search') !== 0) {
        return { ok: false, error: 'dom_navigation_required', to: target, navMethod: 'navigateSearch', navArgs: args || {} };
      }
      return extractSearch(args || {});
    },
    search(args) {
      return this.dom_search(args || {});
    },
    sessionState,
    navigateSearch(args) {
      return navigateTo(searchTarget(args || {}));
    },
    navigateHome() {
      return navigateTo('https://www.zhihu.com/');
    },
  };
  window.__jse_zhihu_search__ = api;
  return { ok: true, version: VERSION };
})()
