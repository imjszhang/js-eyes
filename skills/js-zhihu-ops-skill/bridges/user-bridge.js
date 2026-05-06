(() => {
  const VERSION = '0.2.0';
  // @@include common.js

  function userTarget(args) {
    if (args && args.url) return new URL(args.url, location.href).toString();
    const slug = args && (args.userSlug || args.userId);
    return slug ? `https://www.zhihu.com/people/${encodeURIComponent(slug)}` : null;
  }

  const api = {
    __meta: { name: 'zhihu-user-bridge', version: VERSION },
    state() {
      const state = currentPageState();
      return { ok: true, data: Object.assign({}, state, { ready: state.ready && state.hasUser }) };
    },
    dom_getUser(args) {
      const target = userTarget(args || {});
      if (target && !/^\/(people|org)\//.test(location.pathname)) {
        return { ok: false, error: 'dom_navigation_required', to: target, navMethod: 'navigateUser', navArgs: args || {} };
      }
      return extractUser(args || {});
    },
    getUser(args) {
      return this.dom_getUser(args || {});
    },
    async dom_getUserAnswers(args) {
      const target = userTarget(args || {});
      if (target && !/^\/(people|org)\//.test(location.pathname)) {
        return { ok: false, error: 'dom_navigation_required', to: target, navMethod: 'navigateUser', navArgs: args || {} };
      }
      return await extractUserList(args || {}, 'answers');
    },
    async getUserAnswers(args) {
      return await this.dom_getUserAnswers(args || {});
    },
    async dom_getUserArticles(args) {
      const target = userTarget(args || {});
      if (target && !/^\/(people|org)\//.test(location.pathname)) {
        return { ok: false, error: 'dom_navigation_required', to: target, navMethod: 'navigateUser', navArgs: args || {} };
      }
      return await extractUserList(args || {}, 'articles');
    },
    async getUserArticles(args) {
      return await this.dom_getUserArticles(args || {});
    },
    sessionState,
    navigateUser(args) {
      const target = userTarget(args || {});
      if (!target) return { ok: false, error: 'missing_target' };
      return navigateTo(target);
    },
    navigateHome() {
      return navigateTo('https://www.zhihu.com/');
    },
  };
  window.__jse_zhihu_user__ = api;
  return { ok: true, version: VERSION };
})()
