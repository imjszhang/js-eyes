// bridges/common.js
// ---------------------------------------------------------------------------
// 本文件是纯浏览器代码，不要被 Node require。
// 每个 bridge 文件顶部包含一行：
//   // @@include ./common.js
// session.js 在注入 bridge 前会把这一行替换为本文件全部内容（lib/session.js::expandBridgeSource）。
//
// 设计取舍：
// - READ 数据 auto = DOM 优先 + API 兜底（与 X 取反，因为小红书 DOM 覆盖广，
//   同源 API 仅在评论 (edith) 等少数路径稳定）。
// - 反爬识别基于 og:xhs:note_* meta 三件齐全；连续 3 次 risk hit → 暂停 5 分钟。
// - navigateLocation 严格限制 *.xiaohongshu.com / *.xhslink.com 同源，绝不跨站跳转。
// ---------------------------------------------------------------------------

const __jseXhsCache = {
  loginCache: null,
  loginCacheHref: null,
  // 软限流状态机（与 X v3.0 同形态，连续 3 次 risk → 暂停 5 分钟）
  antiCrawl: {
    paused: false,
    pauseUntil: 0,
    consecutiveRiskHits: 0,
  },
};

const __JSE_XHS_PAUSE_MS = 5 * 60 * 1000;
const __JSE_XHS_MAX_CONSECUTIVE_RISK = 3;

const XHS_HOST_RE = /(?:^|\.)(?:xiaohongshu\.com|xhscdn\.com)$/i;
const XHS_SHORT_HOST_RE = /(?:^|\.)xhslink\.com$/i;

function clampLimit(value, defaultValue, maxValue) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(Math.floor(n), maxValue);
}

function shortText(value, maxLen) {
  const text = String(value == null ? '' : value);
  const limit = clampLimit(maxLen, 2000, 20000);
  if (text.length <= limit) return { text, truncated: false, length: text.length };
  return { text: text.slice(0, limit), truncated: true, length: text.length };
}

function okResult(data) { return { ok: true, data, antiCrawlState: snapshotAntiCrawl() }; }
function errResult(error, extra) {
  return Object.assign({ ok: false, error: String(error) }, extra || {}, { antiCrawlState: snapshotAntiCrawl() });
}

function snapshotAntiCrawl() {
  return {
    paused: __jseXhsCache.antiCrawl.paused,
    pauseUntil: __jseXhsCache.antiCrawl.pauseUntil,
    consecutiveRiskHits: __jseXhsCache.antiCrawl.consecutiveRiskHits,
  };
}

function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function isOnXhs() {
  try {
    return XHS_HOST_RE.test(location.hostname) || XHS_SHORT_HOST_RE.test(location.hostname);
  } catch (_) { return false; }
}

function getCookieValue(name) {
  try {
    var re = new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()\[\]\\\/+^]/g, '\\$&') + '=([^;]*)');
    var m = document.cookie.match(re);
    return m ? decodeURIComponent(m[1]) : null;
  } catch (_) { return null; }
}

function getXhsAuthCookies() {
  return {
    a1: getCookieValue('a1'),
    web_session: getCookieValue('web_session'),
    webId: getCookieValue('webId'),
  };
}

// ---------------------------------------------------------------------------
// 反爬：软限流 / 状态机
// ---------------------------------------------------------------------------

function isAntiCrawlPaused() {
  var s = __jseXhsCache.antiCrawl;
  if (!s.paused) return false;
  if (Date.now() >= s.pauseUntil) {
    s.paused = false;
    s.pauseUntil = 0;
    s.consecutiveRiskHits = 0;
    return false;
  }
  return true;
}

function recordRiskHit(reason) {
  var s = __jseXhsCache.antiCrawl;
  s.consecutiveRiskHits = (s.consecutiveRiskHits | 0) + 1;
  if (s.consecutiveRiskHits >= __JSE_XHS_MAX_CONSECUTIVE_RISK) {
    s.paused = true;
    s.pauseUntil = Date.now() + __JSE_XHS_PAUSE_MS;
  }
  return { paused: s.paused, pauseUntil: s.pauseUntil, consecutiveRiskHits: s.consecutiveRiskHits, reason: reason || null };
}

function recordSuccess() {
  __jseXhsCache.antiCrawl.consecutiveRiskHits = 0;
}

// ---------------------------------------------------------------------------
// HTTP / API
// ---------------------------------------------------------------------------

/**
 * fetchXhsApi - bridge 内同源 fetch（自动带 cookie）。
 * 用于评论 API（edith）等。
 *
 * @param {string} apiUrl 完整 URL（必须 *.xiaohongshu.com）
 * @param {Object} [options] - { method, headers, body, timeoutMs }
 * @returns {Promise<{ ok, status, data?, error?, contentType?, snippet? }>}
 */
async function fetchXhsApi(apiUrl, options) {
  options = options || {};
  if (isAntiCrawlPaused()) {
    return errResult('anti_crawl_paused', { pauseUntil: __jseXhsCache.antiCrawl.pauseUntil });
  }
  var u;
  try { u = new URL(apiUrl, location.href); } catch (_) {
    return errResult('bad_url', { url: apiUrl });
  }
  if (!XHS_HOST_RE.test(u.hostname)) {
    return errResult('cross_origin_forbidden', { hostname: u.hostname });
  }

  var headers = Object.assign({
    'accept': 'application/json, text/plain, */*',
  }, options.headers || {});

  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timeoutMs = options.timeoutMs || 25000;
  var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, timeoutMs) : null;

  try {
    var resp = await fetch(u.toString(), {
      method: options.method || 'GET',
      headers: headers,
      body: options.body,
      credentials: 'include',
      signal: ctrl ? ctrl.signal : undefined,
    });
    var contentType = resp.headers.get('content-type') || '';
    if (!resp.ok) {
      if (resp.status === 429 || resp.status === 461) {
        recordRiskHit('http_' + resp.status);
      }
      var snippet = '';
      try { snippet = (await resp.text()).slice(0, 500); } catch (_) {}
      return errResult('http_' + resp.status, { status: resp.status, contentType: contentType, snippet: snippet });
    }
    if (contentType.indexOf('application/json') === -1) {
      var raw = '';
      try { raw = await resp.text(); } catch (_) {}
      return errResult('non_json_response', { status: resp.status, contentType: contentType, snippet: shortText(raw, 500).text });
    }
    var json = await resp.json();
    if (json && json.success === false) {
      if (json.code === -1 || /verify|risk|behavior/i.test(json.msg || '')) {
        recordRiskHit('xhs_risk_code_' + json.code);
      }
      return errResult('xhs_api_error', { status: resp.status, code: json.code, msg: json.msg, payload: json });
    }
    recordSuccess();
    return { ok: true, data: json, status: resp.status, antiCrawlState: snapshotAntiCrawl() };
  } catch (err) {
    return errResult('fetch_failed', { message: String((err && err.message) || err) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Note meta 解析（OG / xhs meta，与 cheerio 路径对位）
// ---------------------------------------------------------------------------

function readMetaContent(name) {
  var el = document.querySelector('meta[name="' + name + '"]');
  if (el && el.getAttribute('content')) return el.getAttribute('content');
  el = document.querySelector('meta[property="' + name + '"]');
  if (el && el.getAttribute('content')) return el.getAttribute('content');
  return null;
}

function parseNoteMeta() {
  var ogTitle = readMetaContent('og:title') || (document.title || '');
  if (ogTitle && ogTitle.length > 6 && ogTitle.endsWith(' - 小红书')) {
    ogTitle = ogTitle.slice(0, -6);
  }
  var description = readMetaContent('description') || readMetaContent('og:description') || '';
  var imageUrls = [];
  document.querySelectorAll('meta[name="og:image"], meta[property="og:image"]').forEach(function (m) {
    var c = m.getAttribute('content');
    if (c) imageUrls.push(c);
  });
  return {
    title: ogTitle || '',
    description: description || '',
    image_urls: Array.from(new Set(imageUrls)),
    note_like: readMetaContent('og:xhs:note_like') || null,
    note_comment: readMetaContent('og:xhs:note_comment') || null,
    note_collect: readMetaContent('og:xhs:note_collect') || null,
  };
}

/**
 * detectAntiCrawl - meta 三件齐全才视为正常笔记页；缺失时记录 risk hit。
 */
function detectAntiCrawl(meta) {
  var hasLike = !!(meta && meta.note_like);
  var hasComment = !!(meta && meta.note_comment);
  var hasCollect = !!(meta && meta.note_collect);
  if (hasLike && hasComment && hasCollect) {
    return { ok: true, reason: 'meta_complete' };
  }
  recordRiskHit('meta_incomplete');
  return { ok: false, reason: 'meta_incomplete', hasLike: hasLike, hasComment: hasComment, hasCollect: hasCollect };
}

// ---------------------------------------------------------------------------
// 媒体白名单
// ---------------------------------------------------------------------------

function pickMediaFromNote(node) {
  if (!node) return [];
  var urls = [];
  node.querySelectorAll('img').forEach(function (img) {
    var src = img.src || img.getAttribute('data-src');
    if (!src) return;
    if (/sns-webpic|sns-img|ci\.xiaohongshu\.com|xhscdn\.com/i.test(src) && !/avatar/i.test(src)) {
      urls.push(src);
    }
  });
  return Array.from(new Set(urls));
}

// ---------------------------------------------------------------------------
// 用户信息（嵌在页面 HTML 里的 JSON）
// ---------------------------------------------------------------------------

function parseUserInfoFromHtml() {
  try {
    var html = document.documentElement.outerHTML;
    var userIdMatch = html.match(/"userId":\s*"([^"]+)"/);
    var nicknameMatch = html.match(/"nickname":\s*"([^"]+)"/);
    var userId = userIdMatch ? userIdMatch[1] : null;
    var nickname = nicknameMatch ? nicknameMatch[1] : null;
    return {
      userId: userId,
      nickname: nickname,
      userUrl: userId ? 'https://www.xiaohongshu.com/user/profile/' + userId : null,
    };
  } catch (_) {
    return { userId: null, nickname: null, userUrl: null };
  }
}

// ---------------------------------------------------------------------------
// 计数文案解析（"1.2万" 之类）
// ---------------------------------------------------------------------------

function parseCountText(value) {
  if (value == null) return null;
  var s = String(value).trim().replace(/\s+/g, '');
  if (!s) return null;
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  var m = s.match(/^([0-9]+(?:\.[0-9]+)?)([万w亿k千])/i);
  if (m) {
    var n = parseFloat(m[1]);
    var unit = m[2].toLowerCase();
    if (unit === '万' || unit === 'w') return Math.round(n * 10000);
    if (unit === '亿') return Math.round(n * 1e8);
    if (unit === 'k') return Math.round(n * 1000);
    if (unit === '千') return Math.round(n * 1000);
  }
  var m2 = s.match(/^([0-9]+(?:\.[0-9]+)?)$/);
  if (m2) return parseFloat(m2[1]);
  return null;
}

// ---------------------------------------------------------------------------
// 评论 normalize
// ---------------------------------------------------------------------------

function normalizeXhsApiComment(comment) {
  if (!comment || typeof comment !== 'object') return null;
  var userInfo = comment.user_info || comment.user || {};
  var replies = Array.isArray(comment.sub_comments)
    ? comment.sub_comments.map(normalizeXhsApiComment).filter(Boolean)
    : [];
  return {
    comment_id: comment.id || comment.comment_id || '',
    author_name: userInfo.nickname || userInfo.user_name || '',
    author_id: userInfo.user_id || userInfo.userId || '',
    author_avatar: userInfo.image || userInfo.avatar || '',
    content: comment.content || comment.note_comment || '',
    like_count: comment.like_count != null ? comment.like_count : (comment.liked_count != null ? comment.liked_count : 0),
    time: comment.create_time || comment.time || '',
    replies: replies,
  };
}

// ---------------------------------------------------------------------------
// session state（登录态）
// ---------------------------------------------------------------------------

function sessionStateCommon() {
  try {
    var cookies = getXhsAuthCookies();
    var loggedIn = !!(cookies.a1 && cookies.web_session);
    var userInfo = parseUserInfoFromHtml();
    return {
      ok: true,
      data: {
        loggedIn: loggedIn,
        url: location.href,
        hostname: location.hostname,
        username: userInfo.nickname || null,
        userId: userInfo.userId || null,
        cookieFlags: { hasA1: !!cookies.a1, hasWebSession: !!cookies.web_session, hasWebId: !!cookies.webId },
      },
      antiCrawlState: snapshotAntiCrawl(),
    };
  } catch (err) {
    return errResult('session_state_failed', { message: String((err && err.message) || err) });
  }
}

// ---------------------------------------------------------------------------
// navigateLocation（仅同源，仅 location.assign）
// ---------------------------------------------------------------------------

function navigateLocation(targetUrl) {
  try {
    var u = new URL(targetUrl, location.href);
    var same = (XHS_HOST_RE.test(u.hostname) || XHS_SHORT_HOST_RE.test(u.hostname));
    if (!same) {
      return { ok: false, error: 'cross_origin_navigation_forbidden', hostname: u.hostname };
    }
    var fromUrl = location.href;
    if (fromUrl === u.toString()) {
      return okResult({ noop: true, from: { url: fromUrl }, to: { url: u.toString() } });
    }
    location.assign(u.toString());
    return okResult({ from: { url: fromUrl }, to: { url: u.toString() } });
  } catch (err) {
    return errResult('navigate_failed', { message: String((err && err.message) || err) });
  }
}

// ---------------------------------------------------------------------------
// URL 解析
// ---------------------------------------------------------------------------

function parseNoteIdFromHref(href) {
  try {
    var u = new URL(href || location.href, location.href);
    var m = u.pathname.match(/\/(?:explore|discovery\/item|search_result)\/([\w-]+)/i);
    if (m) {
      return {
        noteId: m[1],
        xsec_token: u.searchParams.get('xsec_token') || '',
        xsec_source: u.searchParams.get('xsec_source') || '',
      };
    }
    return null;
  } catch (_) { return null; }
}
