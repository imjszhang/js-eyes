// bridges/front-bridge.js
(function install(){
  'use strict';
  const VERSION = '1.0.0';

  // @@include ./common.js

  const FEED_PATHS = {
    top: '/news',
    new: '/newest',
    best: '/best',
    ask: '/ask',
    show: '/show',
    job: '/jobs',
  };

  async function probe(){
    const login = readLoginState();
    return okResult({
      url: location.href,
      feed: detectFeedFromPath(),
      login: { loggedIn: !!login.loggedIn, name: login.name, source: login.source },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'front-bridge' },
    });
  }

  function detectFeedFromPath(){
    const p = location.pathname || '/';
    if (p === '/newest' || p === '/newest/') return 'new';
    if (p === '/best' || p === '/best/') return 'best';
    if (p === '/ask' || p === '/ask/') return 'ask';
    if (p === '/show' || p === '/show/') return 'show';
    if (p === '/jobs' || p === '/jobs/') return 'job';
    return 'top';
  }

  async function state(){
    const feed = detectFeedFromPath();
    return okResult({
      ready: true,
      reason: null,
      url: location.href,
      feed,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function api_getFrontPage(args){
    args = args || {};
    const feed = normalizeFeed(args.feed);
    const limit = clampLimit(args.limit, 30, 100);
    const page = clampLimit(args.page, 1, 10);
    const t0 = Date.now();
    const storiesResp = await fetchHnFirebase(feedStoriesPath(feed));
    if (!storiesResp.ok || !Array.isArray(storiesResp.data)) {
      return errResult('fetch_stories_failed', {
        httpStatus: storiesResp.httpStatus,
        url: storiesResp.url,
        message: storiesResp.message || null,
      });
    }
    let ids = storiesResp.data;
    if (page > 1) {
      const offset = (page - 1) * limit;
      ids = ids.slice(offset, offset + limit);
    } else {
      ids = ids.slice(0, limit);
    }
    const rawItems = await batchFetchItems(ids, limit);
    const stories = rawItems.map(summarizeApiItem).filter(Boolean);
    return okResult({
      feed,
      page,
      limit,
      stories,
      meta: {
        bridge: 'front-bridge',
        version: VERSION,
        readMode: 'api',
        endpoint: storiesResp.url,
        fetchDurationMs: Date.now() - t0,
        count: stories.length,
      },
    });
  }

  async function dom_getFrontPage(args){
    args = args || {};
    const feed = normalizeFeed(args.feed);
    const limit = clampLimit(args.limit, 30, 100);
    const stories = parseFrontPageDom(limit);
    return okResult({
      feed,
      page: clampLimit(args.page, 1, 10),
      limit,
      stories,
      meta: {
        bridge: 'front-bridge',
        version: VERSION,
        readMode: 'dom',
        count: stories.length,
      },
    });
  }

  async function getFrontPage(args){
    args = args || {};
    const mode = resolveReadMode(args.readMode);
    if (mode === 'dom') return dom_getFrontPage(args);
    const apiRes = await api_getFrontPage(args);
    if (mode === 'api') return apiRes;
    if (apiRes.ok) return apiRes;
    const domRes = await dom_getFrontPage(args);
    if (domRes.ok) {
      domRes.data.meta = Object.assign({}, domRes.data.meta, { bridgeFallbackReason: apiRes.error || 'api_failed' });
    }
    return domRes;
  }

  function navigateFront(args){
    args = args || {};
    const feed = normalizeFeed(args.feed);
    const page = clampLimit(args.page, 1, 10);
    let path = FEED_PATHS[feed] || '/news';
    if (page > 1) path += '?p=' + page;
    return navigateLocation('https://news.ycombinator.com' + path);
  }

  const api = {
    __meta: { version: VERSION, name: 'front-bridge' },
    probe,
    state,
    sessionState,
    getFrontPage,
    api_getFrontPage,
    dom_getFrontPage,
    navigateFront,
  };
  window.__jse_hn_front__ = api;
  return { ok: true, version: VERSION, name: 'front-bridge' };
})();
