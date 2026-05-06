(() => {
  const VERSION = '0.2.0';
  // @@include common.js

  function questionTarget(args) {
    if (args && args.url) return new URL(args.url, location.href).toString();
    if (args && args.questionId) return `https://www.zhihu.com/question/${encodeURIComponent(args.questionId)}`;
    return null;
  }

  const api = {
    __meta: { name: 'zhihu-question-bridge', version: VERSION },
    state() {
      const state = currentPageState();
      return { ok: true, data: Object.assign({}, state, { ready: state.ready && state.hasQuestion }) };
    },
    async dom_getQuestionAnswers(args) {
      const target = questionTarget(args || {});
      if (target && location.href !== target && !/\/question\/\d+/.test(location.pathname)) {
        return { ok: false, error: 'dom_navigation_required', to: target, navMethod: 'navigateQuestion', navArgs: args || {} };
      }
      return await extractQuestionAnswers(args || {});
    },
    async getQuestionAnswers(args) {
      return await this.dom_getQuestionAnswers(args || {});
    },
    sessionState,
    navigateQuestion(args) {
      const target = questionTarget(args || {});
      if (!target) return { ok: false, error: 'missing_target' };
      return navigateTo(target);
    },
    navigateHome() {
      return navigateTo('https://www.zhihu.com/');
    },
  };
  window.__jse_zhihu_question__ = api;
  return { ok: true, version: VERSION };
})()
