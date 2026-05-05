// bridges/user-bridge.js
// ---------------------------------------------------------------------------
// 小红书用户主页 bridge。
//
// 暴露 window.__jse_xhs_user__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   navigateUser({ userId })
//   getUser({ userId? })
//   getUserNotes({ userId?, maxPages? })
//   dom_getUser / dom_getUserNotes
// ---------------------------------------------------------------------------

(function install() {
  'use strict';
  const VERSION = '0.1.3';

  // @@include ./common.js

  function _stateReady() {
    return /^\/user\/profile\//.test(location.pathname || '');
  }

  function _userIdFromHref(href) {
    try {
      var u = new URL(href || location.href, location.href);
      var m = u.pathname.match(/^\/user\/profile\/([^/?#]+)/);
      return m ? m[1] : null;
    } catch (_) { return null; }
  }

  function probe() {
    var session = sessionStateCommon();
    return okResult({
      url: location.href,
      hostname: location.hostname,
      bridge: { version: VERSION, name: 'user-bridge' },
      login: session && session.data ? session.data : null,
      userId: _userIdFromHref(location.href),
      timestamp: new Date().toISOString(),
    });
  }

  function state() {
    var ready = _stateReady();
    return okResult({
      ready: ready,
      reason: ready ? null : 'not_on_user_profile',
      url: location.href,
      bridgeVersion: VERSION,
    });
  }

  function sessionState() { return sessionStateCommon(); }

  function navigateUser(args) {
    args = args || {};
    if (!args.userId) return errResult('bad_arg', { reason: 'userId required' });
    return navigateLocation('https://www.xiaohongshu.com/user/profile/' + encodeURIComponent(args.userId));
  }

  // -------- DOM 提取 --------

  function _waitFor(selector, timeoutMs) {
    return new Promise(function (resolve) {
      var deadline = Date.now() + (timeoutMs || 6000);
      function tick() {
        var el = document.querySelector(selector);
        if (el) return resolve(el);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(tick, 200);
      }
      tick();
    });
  }

  async function dom_getUser(args) {
    args = args || {};
    var targetUserId = args.userId || _userIdFromHref(location.href);
    if (!_stateReady() || (targetUserId && _userIdFromHref(location.href) !== targetUserId)) {
      var to = 'https://www.xiaohongshu.com/user/profile/' + encodeURIComponent(targetUserId || '');
      return { ok: false, error: 'dom_navigation_required', to: to,
        navMethod: 'navigateUser', navArgs: { userId: targetUserId } };
    }

    var card = await _waitFor('.user-info, .user-page-info, .user-info-wrapper', 6000);
    if (!card) return errResult('dom_extract_failed', { reason: 'no_user_info' });

    function pickText(selectors) {
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) {
          var t = (el.textContent || '').trim();
          if (t) return t;
        }
      }
      return '';
    }
    function pickCount(selectors) {
      return parseCountText(pickText(selectors));
    }

    var nickname = pickText(['.user-info .username', '.user-name', '.username']);
    var bio = pickText(['.user-info .description', '.user-desc', '.user-info-desc']);

    // 关注 / 粉丝 / 获赞 解析：
    //   实测 .user-interactions 整段 text = "179关注3328粉丝1.1万获赞与收藏"
    //   span 列表是交替 "数字 文本 数字 文本 ..."
    //   按 keyword 配对（兼容布局变化）。
    var follows = null, fans = null, interactions = null;
    try {
      var spans = document.querySelectorAll('.user-interactions span, .user-interactions div, .user-statistics span');
      for (var si = 0; si < spans.length; si++) {
        var label = (spans[si].textContent || '').trim();
        if (/^关注$/.test(label) && si > 0) follows = parseCountText((spans[si - 1].textContent || '').trim());
        else if (/^粉丝$/.test(label) && si > 0) fans = parseCountText((spans[si - 1].textContent || '').trim());
        else if (/获赞|与收藏|获赞与收藏/.test(label) && si > 0) interactions = parseCountText((spans[si - 1].textContent || '').trim());
      }
    } catch (_) {}
    // 旧 selector fallback
    if (follows == null) follows = pickCount(['.user-info .follows .count', '.follows .count']);
    if (fans == null) fans = pickCount(['.user-info .fans .count', '.fans .count']);
    if (interactions == null) interactions = pickCount(['.interactions .count']);
    var avatar = (document.querySelector('.user-info .avatar img, .user-page-info .avatar img, .avatar img') || {}).src || null;
    var redId = pickText(['.user-redId', '.user-info .red-id', '.user-info-id']);

    return okResult({
      userId: _userIdFromHref(location.href),
      nickname: nickname,
      bio: bio,
      avatar: avatar,
      redId: redId,
      stats: { follows: follows, fans: fans, interactions: interactions },
      url: location.href,
      meta: { source: 'dom', bridge: 'user-bridge', version: VERSION },
    });
  }

  function getUser(args) { return dom_getUser(args || {}); }

  // -------- 用户笔记列表 --------

  async function dom_getUserNotes(args) {
    args = args || {};
    var targetUserId = args.userId || _userIdFromHref(location.href);
    if (!_stateReady() || (targetUserId && _userIdFromHref(location.href) !== targetUserId)) {
      var to = 'https://www.xiaohongshu.com/user/profile/' + encodeURIComponent(targetUserId || '');
      return { ok: false, error: 'dom_navigation_required', to: to,
        navMethod: 'navigateUser', navArgs: { userId: targetUserId } };
    }

    var maxPages = clampLimit(args.maxPages, 3, 30);
    var notes = [];
    var seenIds = new Set();
    var idle = 0;

    function snap() {
      var added = 0;
      var nodes = document.querySelectorAll('.feeds-container .note-item, section.note-item, .user-note-item');
      nodes.forEach(function (node) {
        // 用户主页笔记卡片：a.cover/a.title 指向 /user/profile/<userId>/<noteId>?xsec_token=...
        // 优先选带 xsec_token 的链接（任何 path 形式）；fallback 用 /explore/ 不带 token 的。
        var anchors = node.querySelectorAll('a[href]');
        if (!anchors.length) return;
        var withToken = null, fallback = null;
        for (var ai = 0; ai < anchors.length; ai++) {
          var h2 = readReactHref(anchors[ai]) || anchors[ai].getAttribute('href') || '';
          if (!h2) continue;
          // 必须含 noteId 模式（/explore/<id> 或 /user/profile/<u>/<id>）
          var hasNote = /\/explore\/[\w-]+/.test(h2) || /\/user\/profile\/[\w-]+\/[\w-]+/.test(h2);
          if (!hasNote) continue;
          if (h2.indexOf('xsec_token=') >= 0) { withToken = h2; break; }
          if (!fallback) fallback = h2;
        }
        var href = withToken || fallback || '';
        var fullUrl = href.startsWith('http') ? href : 'https://www.xiaohongshu.com' + href;
        var ref = parseNoteIdFromHref(fullUrl);
        if (!ref || !ref.noteId || seenIds.has(ref.noteId)) return;
        seenIds.add(ref.noteId);
        var titleEl = node.querySelector('.title, .footer .title');
        var likeEl = node.querySelector('.like-wrapper .count, .count');
        var coverImg = node.querySelector('img');
        notes.push({
          noteId: ref.noteId,
          xsec_token: ref.xsec_token || '',
          url: 'https://www.xiaohongshu.com/explore/' + ref.noteId
            + (ref.xsec_token ? ('?xsec_token=' + encodeURIComponent(ref.xsec_token)) : ''),
          title: titleEl ? (titleEl.textContent || '').trim() : '',
          likeCount: parseCountText(likeEl ? likeEl.textContent : ''),
          cover: coverImg ? (coverImg.getAttribute('src') || coverImg.getAttribute('data-src')) : null,
        });
        added++;
      });
      return added;
    }

    snap();
    for (var page = 0; page < maxPages * 4; page++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await delay(1200);
      var added = snap();
      if (added === 0) {
        idle++;
        if (idle >= 3) break;
      } else {
        idle = 0;
      }
    }

    return okResult({
      userId: _userIdFromHref(location.href),
      total: notes.length,
      notes: notes,
      meta: { source: 'dom', bridge: 'user-bridge', version: VERSION, maxPages: maxPages },
    });
  }

  function getUserNotes(args) { return dom_getUserNotes(args || {}); }

  window.__jse_xhs_user__ = {
    __meta: { version: VERSION, name: 'user-bridge' },
    probe: probe,
    state: state,
    sessionState: sessionState,
    navigateUser: navigateUser,
    getUser: getUser,
    dom_getUser: dom_getUser,
    getUserNotes: getUserNotes,
    dom_getUserNotes: dom_getUserNotes,
  };

  return { ok: true, version: VERSION, name: 'user-bridge' };
})();
