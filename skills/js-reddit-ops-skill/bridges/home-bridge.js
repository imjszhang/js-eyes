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
  const VERSION = '3.4.1';

  // @@include ./common.js

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
  };
  window.__jse_reddit_home__ = api;
  return { ok: true, version: VERSION, name: 'home-bridge' };
})();
