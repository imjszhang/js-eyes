// bridges/home-bridge.js
// ---------------------------------------------------------------------------
// Reddit 首页 / popular / all bridge。
//
// 暴露 window.__jse_reddit_home__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   myFeed({ feed?, sort?, t?, limit?, after? })
//
// feed ∈ {home, popular, all}
// sort ∈ {best, hot, new, top, rising}
// home 在已登录状态下是个性化推荐流；未登录会被 reddit 重定向到 popular（自动透传）。
// ---------------------------------------------------------------------------

(function install(){
  'use strict';
  const VERSION = '3.6.0';

  // @@include ./common.js
  // @@include ./_dom-actions.js

  const DEFAULT_LIMIT = 25;
  const MAX_LIMIT = 100;
  const ALLOWED_FEEDS = new Set(['home', 'popular', 'all']);
  const ALLOWED_SORTS = new Set(['best', 'hot', 'new', 'top', 'rising']);
  const ALLOWED_T = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);

  function parseFeedFromPath(){
    const p = location.pathname || '/';
    if (p === '/' || /^\/best\/?$/i.test(p)) return 'home';
    const m = /^\/r\/(popular|all|home)\/?/.exec(p);
    return m ? m[1] : null;
  }

  function parseSortFromPath(){
    const m = /^\/(?:r\/(?:popular|all|home)\/)?(best|hot|new|top|rising)\/?/.exec(location.pathname || '');
    return m ? m[1] : null;
  }

  async function probe(){
    const feed = parseFeedFromPath();
    const sort = parseSortFromPath();
    let me = { loggedIn: false };
    try { me = await readMeViaApi(false); } catch (_) {}
    return okResult({
      url: location.href,
      frontend: detectFrontend(),
      feed,
      sort,
      login: { api: me, dom: readLoginStateDom(), loggedIn: !!(me.loggedIn || readLoginStateDom().loggedIn) },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'home-bridge' },
    });
  }

  async function state(){
    const feed = parseFeedFromPath();
    const sort = parseSortFromPath();
    return okResult({
      ready: !!feed,
      reason: feed ? null : 'not_on_home_or_popular',
      url: location.href,
      feed,
      sort,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function myFeed(args){
    args = args || {};
    const rawFeed = String(args.feed || parseFeedFromPath() || 'home').toLowerCase();
    const feed = ALLOWED_FEEDS.has(rawFeed) ? rawFeed : 'home';
    const rawSort = String(args.sort || parseSortFromPath() || (feed === 'home' ? 'best' : 'hot')).toLowerCase();
    const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : 'hot';
    const rawT = String(args.t || 'day').toLowerCase();
    const t = ALLOWED_T.has(rawT) ? rawT : 'day';
    const limit = clampLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const after = args.after ? String(args.after) : null;

    let path;
    if (feed === 'home') {
      path = sort === 'best' ? '/.json' : `/${sort}.json`;
    } else {
      path = `/r/${feed}/${sort}.json`;
    }
    const params = { limit };
    if (sort === 'top' || sort === 'controversial') params.t = t;
    if (after) params.after = after;
    const t0 = Date.now();
    const resp = await fetchRedditJson(path, params, { textLimit: 2048 });
    const fetchDurationMs = Date.now() - t0;
    if (!resp.ok || !resp.data || resp.data._nonJson) {
      return errResult('fetch_failed', { httpStatus: resp.httpStatus, url: resp.url });
    }
    const summary = summarizeListing(resp.data, { normalize: normalizePostListingItem });
    return okResult({
      feed,
      sort,
      t,
      requestedLimit: limit,
      ...summary,
      meta: {
        bridge: 'home-bridge',
        version: VERSION,
        endpoint: resp.url,
        httpStatus: resp.httpStatus,
        fetchDurationMs,
        truncated: summary.returnedCount >= limit,
      },
    });
  }

  // ---- v3.7.0 dom-first ----------------------------------------------------

  function _targetHomeUrl(feed, sort){
    const f = ALLOWED_FEEDS.has(feed) ? feed : 'home';
    const s = ALLOWED_SORTS.has(sort) ? sort : null;
    if (f === 'home') {
      return s && s !== 'best' ? `https://www.reddit.com/${s}/` : 'https://www.reddit.com/';
    }
    return `https://www.reddit.com/r/${f}/${s ? s + '/' : ''}`;
  }

  function _extractHomePostFromShreddit(node){
    if (!node) return null;
    const get = function(name){
      try { return node.getAttribute ? node.getAttribute(name) : null; } catch (_) { return null; }
    };
    const id = get('id') || get('post-id') || '';
    if (!id && !get('post-title')) return null;
    const num = function(v){ const n = Number(v); return Number.isFinite(n) ? n : null; };
    return {
      id: id || null,
      kind: 't3',
      title: get('post-title') || '',
      author: get('author') || '',
      subreddit: get('subreddit-prefixed-name') || get('subreddit-name') || '',
      score: num(get('score')),
      numComments: num(get('comment-count')) != null ? num(get('comment-count')) : num(get('num-comments')),
      createdAt: get('created-timestamp') || null,
      postType: get('post-type') || null,
      contentHref: get('content-href') || null,
      permalink: get('permalink') || null,
      domain: get('domain') || null,
      _domSource: 'shreddit-post',
    };
  }

  async function dom_myFeed(args){
    args = args || {};
    const rawFeed = String(args.feed || parseFeedFromPath() || 'home').toLowerCase();
    const feed = ALLOWED_FEEDS.has(rawFeed) ? rawFeed : 'home';
    const rawSort = String(args.sort || parseSortFromPath() || (feed === 'home' ? 'best' : 'hot')).toLowerCase();
    const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : 'hot';
    const limit = clampLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);

    const curFeed = parseFeedFromPath();
    const curSort = parseSortFromPath();
    const targetUrl = _targetHomeUrl(feed, sort);
    if (!curFeed || curFeed !== feed || (sort !== 'best' && curSort !== sort)) {
      __jseDomEmitNavigateIntent(targetUrl);
      return errResult('dom_navigation_required', {
        to: targetUrl,
        navMethod: 'navigateHome',
        navArgs: { feed, sort },
        retry: true,
      });
    }

    const t0 = Date.now();
    const waitRes = await __jseDomWaitFor(
      ['shreddit-post', 'article[data-post-id]', '[id^="t3_"]'],
      { count: Math.min(limit, 5), timeoutMs: 9000 }
    );
    if (!waitRes.ok) {
      return errResult('dom_timeout', { stage: 'wait_feed', detail: waitRes });
    }
    const ext = __jseDomExtract(
      [waitRes.selector, 'shreddit-post'],
      _extractHomePostFromShreddit,
      { limit }
    );
    if (!ext.ok) {
      return errResult('dom_extract_failed', { stage: 'extract_feed', detail: ext });
    }
    const items = ext.items.slice(0, limit);
    const fetchDurationMs = Date.now() - t0;
    return okResult({
      feed,
      sort,
      t: null,
      requestedLimit: limit,
      returnedCount: items.length,
      items,
      meta: {
        bridge: 'home-bridge',
        version: VERSION,
        endpoint: location.href,
        fetchDurationMs,
        domSelector: ext.selector,
        truncated: items.length >= limit,
        source: 'dom',
      },
    });
  }

  // sessionState 在 PR 1 已半 DOM 化（读 user dropdown）；这里直接复用 + emit dom_locate
  // 表示"读取登录态"这一动作。
  async function dom_sessionState(args){
    const r = sessionStateCommon();
    try {
      const found = __jseDomQuery(['#expand-user-drawer-button', 'faceplate-tracker[noun="user_drawer"]', 'shreddit-async-loader[bundlename="header_user_dropdown"]']);
      if (found) {
        const rect = (function(el){ try { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; } catch (_) { return null; } })(found.el);
        __jseDomEmit('dom_locate', { selector: found.selector, rect });
      }
    } catch (_) {}
    if (r && r.data) r.data.source = 'dom';
    return r;
  }

  function navigateHome(args){
    args = args || {};
    const rawFeed = String(args.feed || 'home').toLowerCase();
    const feed = ALLOWED_FEEDS.has(rawFeed) ? rawFeed : 'home';
    const rawSort = args.sort != null ? String(args.sort).toLowerCase() : null;
    const sort = rawSort && ALLOWED_SORTS.has(rawSort) ? rawSort : null;
    let url;
    if (feed === 'home') {
      url = sort && sort !== 'best'
        ? `https://www.reddit.com/${sort}/`
        : 'https://www.reddit.com/';
    } else {
      url = `https://www.reddit.com/r/${feed}/${sort ? sort + '/' : ''}`;
    }
    if (sort === 'top' || sort === 'controversial') {
      const t = args.t && ALLOWED_T.has(String(args.t).toLowerCase()) ? String(args.t).toLowerCase() : null;
      if (t) url += (url.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(t);
    }
    return navigateLocation(url);
  }

  const api = {
    __meta: { version: VERSION, name: 'home-bridge' },
    probe,
    state,
    sessionState,
    myFeed,
    navigateHome,
    dom_myFeed,
    dom_sessionState,
  };
  for (const k of Object.keys(api)) {
    if (k === '__meta' || k.indexOf('api_') === 0 || k.indexOf('dom_') === 0) continue;
    if (typeof api[k] === 'function') api['api_' + k] = api[k];
  }
  window.__jse_reddit_home__ = api;
  return { ok: true, version: VERSION, name: 'home-bridge' };
})();
