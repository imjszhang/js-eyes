(() => {
  const VERSION = '0.1.1';
  // @@include common.js

  function answerTarget(args) {
    if (args && args.url) return new URL(args.url, location.href).toString();
    if (args && args.questionId && args.answerId) {
      return `https://www.zhihu.com/question/${encodeURIComponent(args.questionId)}/answer/${encodeURIComponent(args.answerId)}`;
    }
    return null;
  }

  const api = {
    __meta: { name: 'zhihu-answer-bridge', version: VERSION },
    state() {
      const state = currentPageState();
      return { ok: true, data: Object.assign({}, state, { ready: state.ready && state.hasAnswer }) };
    },
    dom_getAnswer(args) {
      const target = answerTarget(args || {});
      if (target && location.href !== target && !/\/answer\/\d+/.test(location.pathname)) {
        return { ok: false, error: 'dom_navigation_required', to: target, navMethod: 'navigateAnswer', navArgs: args || {} };
      }
      return extractAnswer(args || {});
    },
    getAnswer(args) {
      return this.dom_getAnswer(args || {});
    },
    sessionState,
    navigateAnswer(args) {
      const target = answerTarget(args || {});
      if (!target) return { ok: false, error: 'missing_target' };
      return navigateTo(target);
    },
    navigateHome() {
      return navigateTo('https://www.zhihu.com/');
    },
  };
  window.__jse_zhihu_answer__ = api;
  return { ok: true, version: VERSION };
})()
