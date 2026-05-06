;(function installZhihuVisualHooks() {
  if (typeof window === 'undefined' || !window || !window.document) return;
  if (!window.__jse_visual || typeof window.__jse_visual.setSiteAnchorResolver !== 'function') return;

  function safeQS(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); } catch (_) { return null; }
  }

  function byHref(part) {
    if (!part) return null;
    try {
      var link = document.querySelector('a[href*="' + String(part).replace(/"/g, '\\"') + '"]');
      return link && (link.closest('.ContentItem, .SearchResult-Card, .List-item, article') || link);
    } catch (_) {
      return null;
    }
  }

  function resolveAnchor(anchor) {
    if (!anchor || typeof anchor !== 'object') {
      return safeQS('.QuestionHeader, .Post-Header, .SearchMain, main, body');
    }
    if (anchor.answerId) {
      return byHref('/answer/' + anchor.answerId)
        || safeQS('.ContentItem.AnswerItem, .AnswerItem, .RichContent-inner');
    }
    if (anchor.articleId) {
      return byHref('/p/' + anchor.articleId)
        || safeQS('.Post-Header, .Post-RichTextContainer, article');
    }
    if (anchor.questionId) {
      return byHref('/question/' + anchor.questionId)
        || safeQS('.QuestionHeader, .Question-main, .QuestionPage');
    }
    if (anchor.userSlug || anchor.userId) {
      var slug = anchor.userSlug || anchor.userId;
      return byHref('/people/' + slug)
        || byHref('/org/' + slug)
        || safeQS('.ProfileHeader, .Profile-main');
    }
    if (anchor.keyword) {
      return safeQS('.SearchResult-Card, .SearchMain, .Search-container, input[placeholder*="搜索"]');
    }
    if (anchor.url) {
      try {
        var u = new URL(anchor.url, location.href);
        var answerId = (u.pathname.match(/\/answer\/(\d+)/) || [])[1];
        var questionId = (u.pathname.match(/\/question\/(\d+)/) || [])[1];
        var articleId = (u.pathname.match(/\/p\/(\d+)/) || [])[1];
        if (answerId) return resolveAnchor({ answerId: answerId });
        if (articleId) return resolveAnchor({ articleId: articleId });
        if (questionId) return resolveAnchor({ questionId: questionId });
      } catch (_) {}
    }
    return safeQS('.QuestionHeader, .Post-Header, .SearchMain, main, body');
  }

  try {
    window.__jse_visual.setSiteAnchorResolver(resolveAnchor);
  } catch (_) {}
})();
