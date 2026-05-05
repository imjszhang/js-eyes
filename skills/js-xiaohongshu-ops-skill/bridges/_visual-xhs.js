// bridges/_visual-xhs.js
// ---------------------------------------------------------------------------
// 小红书站点 visual hooks：把 visualHint.anchor 映射成具体 DOM 元素。
//
// hint.anchor 形态（lib/visualHint.js）：
//   - { noteId: '<32hex>' } → 笔记 / 搜索结果列表项
//   - { userId: '<24hex>' } → 用户主页 / 用户卡片
//   - { commentId: '<24hex>' } → 评论项（暂不支持精准定位，退回 .comments-container）
//
// 基于真实 DOM probe（2026-05-05，xhs web 版）：
//   笔记详情页：#noteContainer, .note-container, .author-container, .comments-container
//   搜索/explore 页：section.note-item（24 个）+ 内部 a[href*='/explore/<noteId>']
//   用户主页：a[href*='/user/profile/<userId>']
//
// 由 bridges/common.js 顶部 `// @@include ./_visual-xhs.js` 注入；
// 依赖 visual.common.js 已建好 window.__jse_visual。
// ---------------------------------------------------------------------------

;(function installXhsVisualHooks() {
  if (typeof window === 'undefined' || !window || !window.document) return;
  if (!window.__jse_visual || typeof window.__jse_visual.setSiteAnchorResolver !== 'function') return;

  function safeQS(sel) {
    if (!sel) return null;
    try { return document.querySelector(sel); } catch (_) { return null; }
  }

  function findCardByNoteId(noteId) {
    if (!noteId) return null;
    // search / explore 列表：a[href*='/explore/<noteId>'] → 向上找 section.note-item
    var a = null;
    try { a = document.querySelector('a[href*="/explore/' + noteId + '"]'); } catch (_) {}
    if (a) {
      var card = a.closest('section.note-item')
        || a.closest('.note-item')
        || a.closest('section')
        || a.closest('.feeds-container > *');
      if (card) return card;
      return a;
    }
    return null;
  }

  function findUserCardByUserId(userId) {
    if (!userId) return null;
    // 用户主页 / 用户卡片：a[href*='/user/profile/<userId>']
    var a = null;
    try { a = document.querySelector('a[href*="/user/profile/' + userId + '"]'); } catch (_) {}
    if (a) {
      var card = a.closest('.user-info-card')
        || a.closest('.user-info')
        || a.closest('.author-wrapper')
        || a.closest('.author-container')
        || a.closest('section');
      if (card) return card;
      return a;
    }
    return null;
  }

  function resolveAnchor(anchor) {
    if (!anchor || typeof anchor !== 'object') return null;

    // 1) 笔记
    if (anchor.noteId) {
      // 优先：当前页就是这条笔记的详情页 → #noteContainer
      var href = '';
      try { href = location.href || ''; } catch (_) {}
      if (href.indexOf(anchor.noteId) >= 0) {
        var nc = safeQS('#noteContainer') || safeQS('.note-container');
        if (nc) return nc;
      }
      // 否则在列表里找卡片
      var card = findCardByNoteId(anchor.noteId);
      if (card) return card;
      // fallback：当前 feeds-page / explore 整页
      return safeQS('.feeds-page') || safeQS('#noteContainer');
    }

    // 2) 用户
    if (anchor.userId) {
      var uHref = '';
      try { uHref = location.href || ''; } catch (_) {}
      if (uHref.indexOf('/user/profile/' + anchor.userId) >= 0) {
        // 当前页是该用户主页 → 用户主信息卡
        return safeQS('.user-info-card')
          || safeQS('.user-info-wrapper')
          || safeQS('.user-page')
          || safeQS('.basic-info');
      }
      var u = findUserCardByUserId(anchor.userId);
      if (u) return u;
      return null;
    }

    // 3) 评论：当前没法从 DOM 拿到 commentId 精确映射 → 整片 comments
    if (anchor.commentId) {
      return safeQS('.comments-container') || safeQS('.comments-el');
    }

    return null;
  }

  try {
    window.__jse_visual.setSiteAnchorResolver(resolveAnchor);
  } catch (_) { /* kit 未加载或版本不匹配，安全忽略 */ }
})();
