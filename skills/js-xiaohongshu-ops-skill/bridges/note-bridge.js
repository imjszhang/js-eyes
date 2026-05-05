// bridges/note-bridge.js
// ---------------------------------------------------------------------------
// 小红书笔记详情 bridge。
//
// 暴露 window.__jse_xhs_note__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   navigateNote({ url? | noteId? })
//   getNote({ url?, noteId?, withComments?, maxCommentPages? })
//   getComments({ url?, noteId?, maxCommentPages? })
//   dom_getNote / api_getNote / dom_getComments / api_getComments （runTool 备路径调用）
//
// 设计原则：DOM 优先 + API 兜底；同源 cookie + edith 评论 API。
// ---------------------------------------------------------------------------

(function install() {
  'use strict';
  const VERSION = '0.1.0';

  // @@include ./common.js

  function _stateReady() {
    var match = location.pathname.match(/^\/(?:explore|discovery\/item)\/([\w-]+)/);
    return !!match;
  }

  function probe() {
    var session = sessionStateCommon();
    var meta = parseNoteMeta();
    var anti = detectAntiCrawl(meta);
    var noteRef = parseNoteIdFromHref(location.href);
    return okResult({
      url: location.href,
      hostname: location.hostname,
      bridge: { version: VERSION, name: 'note-bridge' },
      login: session && session.data ? session.data : null,
      noteRef: noteRef,
      meta: meta,
      antiCrawl: anti,
      timestamp: new Date().toISOString(),
    });
  }

  function state() {
    var ready = _stateReady();
    return okResult({
      ready: ready,
      reason: ready ? null : 'not_on_note_page',
      url: location.href,
      bridgeVersion: VERSION,
    });
  }

  function sessionState() { return sessionStateCommon(); }

  function navigateNote(args) {
    args = args || {};
    if (args.url) {
      return navigateLocation(String(args.url));
    }
    if (args.noteId) {
      return navigateLocation('https://www.xiaohongshu.com/explore/' + encodeURIComponent(args.noteId));
    }
    return errResult('bad_arg', { reason: 'url or noteId required' });
  }

  // -------------------- 笔记详情：DOM 路径 --------------------

  function _waitFor(selector, timeoutMs) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + (timeoutMs || 8000);
      function tick() {
        var el = document.querySelector(selector);
        if (el) return resolve(el);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(tick, 200);
      }
      tick();
    });
  }

  async function dom_getNote(args) {
    args = args || {};
    if (!_stateReady()) {
      var noteId = args.noteId || (parseNoteIdFromHref(location.href) || {}).noteId;
      var to = args.url
        || (noteId ? 'https://www.xiaohongshu.com/explore/' + encodeURIComponent(noteId) : null);
      if (to) {
        return { ok: false, error: 'dom_navigation_required', to: to, navMethod: 'navigateNote', navArgs: { url: to } };
      }
      return errResult('dom_not_found', { reason: 'not_on_note_page' });
    }

    // 等待容器出现
    var container = await _waitFor('#noteContainer, .note-container, .note-content', 6000);
    if (!container) {
      return errResult('dom_extract_failed', { reason: 'no_note_container' });
    }

    var meta = parseNoteMeta();
    var anti = detectAntiCrawl(meta);

    function pickText(selectors) {
      for (var i = 0; i < selectors.length; i++) {
        var el = container.querySelector(selectors[i]) || document.querySelector(selectors[i]);
        if (el) {
          var t = (el.textContent || '').trim();
          if (t) return t;
        }
      }
      return '';
    }

    function pickCount(selectors) {
      var raw = pickText(selectors);
      return parseCountText(raw);
    }

    var title = pickText(['#detail-title', '.note-content .title', 'h1.title']) || meta.title;
    var content = pickText(['.note-content .desc', '#detail-desc', '.note-text', '.desc']) || meta.description;

    var likes = pickCount([
      '#noteContainer .engage-bar .like-wrapper .count',
      '#noteContainer .like-wrapper .count',
      '.engage-bar .like-wrapper .count',
      '.like-wrapper .count',
    ]);
    var collects = pickCount([
      '#noteContainer .engage-bar .collect-wrapper .count',
      '#noteContainer .collect-wrapper .count',
      '.engage-bar .collect-wrapper .count',
      '.collect-wrapper .count',
    ]);
    var comments = pickCount([
      '#noteContainer .engage-bar .chat-wrapper .count',
      '#noteContainer .chat-wrapper .count',
      '.engage-bar .chat-wrapper .count',
      '.chat-wrapper .count',
    ]);

    // 图片：优先轮播 swiper，回退所有过滤后的小红书图床图。
    var imgUrls = pickMediaFromNote(container);
    if (imgUrls.length === 0 && meta.image_urls.length) imgUrls = meta.image_urls;

    // 作者（DOM）
    var authorName = pickText([
      '.author-container .username',
      '.username',
      '.author-container .author-name',
      '.user-name',
    ]);
    var authorLink = container.querySelector('a[href*="/user/profile/"]')
      || document.querySelector('a[href*="/user/profile/"]');
    var authorId = null;
    if (authorLink) {
      var m = (authorLink.getAttribute('href') || '').match(/\/user\/profile\/([^?#]+)/);
      if (m) authorId = m[1];
    }

    // 评论（仅前 N 条 DOM 摘要；不分页，要分页用 api_getComments）
    var inlineComments = [];
    document.querySelectorAll('.comment-item, .comment-inner-container').forEach(function (el, idx) {
      if (idx >= 10) return;
      var cn = el.querySelector('.nickname, .user-name, .name');
      var ct = el.querySelector('.content, .comment-content, .text');
      var tm = el.querySelector('.time, .date');
      if (ct && (ct.textContent || '').trim()) {
        inlineComments.push({
          comment_id: (el.id || '').replace(/^comment-/, ''),
          author_name: cn ? (cn.textContent || '').trim() : '',
          author_id: '',
          author_avatar: '',
          content: (ct.textContent || '').trim(),
          like_count: 0,
          time: tm ? (tm.textContent || '').trim() : '',
          replies: [],
        });
      }
    });

    var noteRef = parseNoteIdFromHref(location.href) || {};
    var data = {
      platform: 'xiaohongshu',
      sourceUrl: location.href,
      noteId: noteRef.noteId || null,
      xsec_token: noteRef.xsec_token || '',
      title: title,
      description: content,
      content: content,
      image_urls: imgUrls,
      stats: {
        likes: likes,
        comments: comments,
        collects: collects,
      },
      note_like: meta.note_like,
      note_comment: meta.note_comment,
      note_collect: meta.note_collect,
      author: {
        nickname: authorName || null,
        userId: authorId,
      },
      comments: inlineComments,
      total_comments_count: comments != null ? comments : inlineComments.length,
      meta: { antiCrawl: anti, source: 'dom' },
    };

    // 可选：抓评论分页（API 路径）
    if (args.withComments && (args.maxCommentPages | 0) > 0) {
      var commentsResp = await api_getComments({
        url: location.href,
        maxCommentPages: args.maxCommentPages,
      });
      if (commentsResp && commentsResp.ok && commentsResp.data) {
        data.comments = commentsResp.data.comments || data.comments;
        data.total_comments_count = commentsResp.data.totalCount || data.total_comments_count;
        data.meta.commentsSource = 'api';
        data.meta.commentsError = commentsResp.data.error || null;
      } else {
        data.meta.commentsError = (commentsResp && commentsResp.error) || 'unknown';
      }
    }

    return okResult(data);
  }

  // -------------------- 笔记详情：API 兜底（基于 meta + 同源 feed JSON 占位） --------------------
  // 小红书 web v1 feed API 不稳定且需要复杂签名；这里仅作 stub，主要靠 dom_getNote。

  async function api_getNote(args) {
    args = args || {};
    var noteRef = args.url ? parseNoteIdFromHref(args.url) : parseNoteIdFromHref(location.href);
    if (!noteRef || !noteRef.noteId) {
      return errResult('graphql_disabled', { reason: 'no_note_id' });
    }
    if (!_stateReady() && !args.url) {
      return { ok: false, error: 'dom_navigation_required',
        to: 'https://www.xiaohongshu.com/explore/' + encodeURIComponent(noteRef.noteId),
        navMethod: 'navigateNote',
        navArgs: { url: 'https://www.xiaohongshu.com/explore/' + encodeURIComponent(noteRef.noteId) } };
    }
    // 退化：依赖 meta + 评论 API
    var meta = parseNoteMeta();
    var anti = detectAntiCrawl(meta);
    var data = {
      platform: 'xiaohongshu',
      sourceUrl: location.href,
      noteId: noteRef.noteId,
      xsec_token: noteRef.xsec_token || '',
      title: meta.title,
      description: meta.description,
      content: meta.description,
      image_urls: meta.image_urls,
      stats: {
        likes: parseCountText(meta.note_like),
        comments: parseCountText(meta.note_comment),
        collects: parseCountText(meta.note_collect),
      },
      note_like: meta.note_like,
      note_comment: meta.note_comment,
      note_collect: meta.note_collect,
      author: parseUserInfoFromHtml(),
      comments: [],
      total_comments_count: parseCountText(meta.note_comment) || 0,
      meta: { antiCrawl: anti, source: 'api_meta_only' },
    };
    if (args.withComments && (args.maxCommentPages | 0) > 0) {
      var c = await api_getComments({ url: location.href, maxCommentPages: args.maxCommentPages });
      if (c && c.ok && c.data) {
        data.comments = c.data.comments || [];
        data.total_comments_count = c.data.totalCount || data.total_comments_count;
        data.meta.commentsSource = 'api';
      }
    }
    return okResult(data);
  }

  function getNote(args) {
    return dom_getNote(args || {});
  }

  // -------------------- 评论：edith API 翻页 --------------------

  async function api_getComments(args) {
    args = args || {};
    var noteRef = args.url ? parseNoteIdFromHref(args.url) : parseNoteIdFromHref(location.href);
    if (!noteRef || !noteRef.noteId) {
      return errResult('bad_arg', { reason: 'no_note_id' });
    }
    var maxPages = clampLimit(args.maxCommentPages, 1, 50);
    var noteId = noteRef.noteId;
    var xsecToken = noteRef.xsec_token || '';

    var cursor = '';
    var hasMore = true;
    var iter = 0;
    var allRaw = [];
    var lastError = null;
    while (hasMore && iter < maxPages) {
      var apiUrl = 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page'
        + '?note_id=' + encodeURIComponent(noteId)
        + '&cursor=' + encodeURIComponent(cursor)
        + '&top_comment_id='
        + '&image_formats=jpg,webp,avif'
        + '&xsec_token=' + encodeURIComponent(xsecToken);
      var resp = await fetchXhsApi(apiUrl, { timeoutMs: 25000 });
      if (!resp.ok) {
        lastError = resp.error || 'unknown';
        if (resp.error === 'anti_crawl_paused') break;
        break;
      }
      var pageData = (resp.data && resp.data.data) || {};
      var comments = Array.isArray(pageData.comments) ? pageData.comments : [];
      allRaw = allRaw.concat(comments);
      hasMore = !!pageData.has_more;
      cursor = pageData.cursor || '';
      iter += 1;
      if (hasMore) await delay(250);
    }
    var normalized = allRaw.map(normalizeXhsApiComment).filter(Boolean);
    return okResult({
      noteId: noteId,
      pages: iter,
      comments: normalized,
      totalCount: normalized.length,
      hasMore: hasMore,
      error: lastError,
    });
  }

  function getComments(args) {
    return api_getComments(args || {});
  }

  // 暴露
  window.__jse_xhs_note__ = {
    __meta: { version: VERSION, name: 'note-bridge' },
    probe: probe,
    state: state,
    sessionState: sessionState,
    navigateNote: navigateNote,
    getNote: getNote,
    dom_getNote: dom_getNote,
    api_getNote: api_getNote,
    getComments: getComments,
    api_getComments: api_getComments,
  };

  return { ok: true, version: VERSION, name: 'note-bridge' };
})();
