(() => {
  const VERSION = '0.1.0';
  // @@include common.js

  const api = {
    __meta: { name: 'zhihu-home-bridge', version: VERSION },
    state() {
      const state = currentPageState();
      return { ok: true, data: Object.assign({}, state, { ready: state.ready }) };
    },
    sessionState,
    navigateHome() {
      return navigateTo('https://www.zhihu.com/');
    },
    navigateSearch(args) {
      const url = new URL('https://www.zhihu.com/search');
      if (args && args.keyword) url.searchParams.set('q', args.keyword);
      return navigateTo(url.toString());
    },
  };
  window.__jse_zhihu_home__ = api;
  return { ok: true, version: VERSION };
})()
