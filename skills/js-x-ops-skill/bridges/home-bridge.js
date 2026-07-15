// bridges/home-bridge.js
// ---------------------------------------------------------------------------
// X.com 首页 Feed bridge（For You / Following）。
//
// 暴露 window.__jse_x_home__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   navigateHome({ feed? })
//   getHome({ feed?, maxPages?, ... })
//
// HomeTimeline = For You；HomeLatestTimeline = Following。
// 遇到 429 连续 3 次暂停 5 分钟。
// ---------------------------------------------------------------------------

(function install(){
  'use strict';
  const VERSION = '3.2.1';

  // @@include ./common.js

  const ALLOWED_FEEDS = new Set(['foryou', 'following']);
  const DEFAULT_MAX_PAGES = 3;
  const MAX_MAX_PAGES = 30;
  const PAGE_DELAY_MS = 2000;
  const PAUSE_AFTER_429_MS = 5 * 60 * 1000;

  function inferFeedFromPath(){
    if (/^\/i\/timeline\/?$/.test(location.pathname || '')) return 'following';
    return 'foryou';
  }

  function feedToOp(feed){
    return feed === 'following' ? 'HomeLatestTimeline' : 'HomeTimeline';
  }

  async function probe(){
    const sessionResp = await sessionStateCommon();
    const dParams = await discoverGraphQLParams(['HomeTimeline', 'HomeLatestTimeline']);
    return okResult({
      url: location.href,
      hostname: location.hostname,
      feedInferred: inferFeedFromPath(),
      login: sessionResp && sessionResp.data ? sessionResp.data : null,
      graphql: dParams.data,
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'home-bridge' },
    });
  }

  async function state(){
    const onHome = /^\/(?:home\/?)?$/.test(location.pathname || '');
    return okResult({
      ready: onHome,
      reason: onHome ? null : 'not_on_home',
      url: location.href,
      feed: inferFeedFromPath(),
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  function domNavigationToHome(args){
    args = args || {};
    return {
      ok: false,
      error: 'dom_navigation_required',
      to: 'https://x.com/home',
      navMethod: 'navigateHome',
      navArgs: { feed: args.feed || 'foryou' },
    };
  }

  function navigateHome(args){
    args = args || {};
    const feed = args.feed && ALLOWED_FEEDS.has(String(args.feed).toLowerCase())
      ? String(args.feed).toLowerCase()
      : 'foryou';
    return navigateLocation('https://x.com/home');
  }

  async function dom_getHome(args){
    args = args || {};
    const feedRaw = String(args.feed || inferFeedFromPath()).toLowerCase();
    const feed = ALLOWED_FEEDS.has(feedRaw) ? feedRaw : 'foryou';
    const maxPages = clampLimit(args.maxPages, DEFAULT_MAX_PAGES, MAX_MAX_PAGES);
    const onHome = /^\/(?:home\/?)?$/.test(location.pathname || '');
    if (!onHome) return domNavigationToHome(args);

    const allTweets = [];
    const seenIds = new Set();
    const pageMeta = [];
    function extractOnce(){
      const detail = collectTweetsFromDomDetailed(document, seenIds);
      for (const tw of detail.tweets) allTweets.push(tw);
      return detail;
    }

    let contentReady = false;
    let lastDomStats = null;
    for (let i = 0; i < 10; i++) {
      const detail = extractOnce();
      lastDomStats = detail.stats;
      if (detail.stats.addedCount > 0) { contentReady = true; break; }
      await delay(800);
    }
    if (!contentReady) {
      const hint = lastDomStats && lastDomStats.articleCount > 0
        ? 'home_tweets_present_but_unparsed'
        : 'home_no_tweets_in_dom';
      return errResult('dom_extract_failed', { hint, domStats: lastDomStats });
    }

    const maxScrollRounds = Math.max(1, Math.min((maxPages | 0), 50));
    let noNewCount = 0;
    for (let round = 1; round < maxScrollRounds; round++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await delay(PAGE_DELAY_MS);
      const detail = extractOnce();
      const more = detail.stats.addedCount;
      pageMeta.push({ page: round + 1, ok: true, added: more, scrollRound: round, domStats: detail.stats });
      if (more === 0) {
        noNewCount++;
        if (noNewCount >= 2) break;
      } else {
        noNewCount = 0;
      }
    }

    return okResult({
      feed,
      total: allTweets.length,
      tweets: allTweets,
      pages: pageMeta,
      meta: {
        bridge: 'home-bridge',
        version: VERSION,
        opName: 'DOM_HOME',
        path: 'dom_getHome',
        endedReason: 'dom_extracted',
        domStats: lastDomStats,
      },
    });
  }

  async function api_getHome(args){
    args = args || {};
    const feedRaw = String(args.feed || inferFeedFromPath()).toLowerCase();
    const feed = ALLOWED_FEEDS.has(feedRaw) ? feedRaw : 'foryou';
    const maxPages = clampLimit(args.maxPages, DEFAULT_MAX_PAGES, MAX_MAX_PAGES);
    const opName = feedToOp(feed);
    const onHome = /^\/(?:home\/?)?$/.test(location.pathname || '');
    if (!onHome) return domNavigationToHome(args);

    let disc = await discoverGraphQLParams([opName]);
    let meta = disc.data && disc.data[opName];
    if (!meta || !meta.queryId) {
      return errResult('graphql_discovery_failed', { opName });
    }
    let features = meta.features || DEFAULT_GRAPHQL_FEATURES;
    let variablesTemplate = meta.variables || null;

    const allTweets = [];
    const seenIds = new Set();
    let cursor = null;
    let consecutive429 = 0;
    let pausedOnce = false;
    let cacheInvalidated = false;
    const pageMeta = [];

    for (let page = 1; page <= maxPages; page++) {
      const variables = variablesTemplate
        ? Object.assign({}, variablesTemplate)
        : { count: 20, includePromotedContent: false, withCommunity: true, withVoice: true };
      if (!variables.count) variables.count = 20;
      if (cursor) variables.cursor = cursor; else delete variables.cursor;

      const t0 = Date.now();
      const resp = await fetchXGraphQL({
        opName,
        queryId: meta.queryId,
        variables,
        features,
        method: 'POST',
        body: { variables, features, queryId: meta.queryId },
      });
      const durMs = Date.now() - t0;

      if (!resp.ok && resp.statusCode === 429) {
        consecutive429++;
        if (consecutive429 >= 3 && !pausedOnce) {
          pausedOnce = true;
          await delay(PAUSE_AFTER_429_MS);
          consecutive429 = 0;
          page--;
          continue;
        }
        await delay(Math.min(((resp.retryAfter || 30) * 1000), 60 * 1000));
        page--;
        continue;
      }
      if (!resp.ok && (resp.statusCode === 400 || resp.statusCode === 404) && !cacheInvalidated) {
        cacheInvalidated = true;
        invalidateGraphQLCache(opName);
        disc = await discoverGraphQLParams([opName]);
        const newMeta = disc.data && disc.data[opName];
        if (newMeta && newMeta.queryId) {
          meta = newMeta;
          features = newMeta.features || features;
          variablesTemplate = newMeta.variables || variablesTemplate;
          page--;
          continue;
        }
      }
      if (!resp.ok) {
        if (page === 1) {
          return errResult('graphql_fallback', { opName, statusCode: resp.statusCode || null });
        }
        pageMeta.push({ page, ok: false, error: resp.error, statusCode: resp.statusCode || null, durMs });
        break;
      }
      consecutive429 = 0;

      let entries = [];
      try {
        const tl = resp.data && resp.data.data && resp.data.data.home && resp.data.data.home.home_timeline_urt;
        const ins = (tl && tl.instructions) || [];
        for (const inst of ins) {
          if (inst.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) {
            entries = entries.concat(inst.entries);
          }
        }
      } catch (_) {}
      const parsed = parseTweetEntries(entries);
      let added = 0;
      for (const tw of parsed.tweets) {
        if (tw && tw.tweetId && !seenIds.has(tw.tweetId)) {
          seenIds.add(tw.tweetId);
          allTweets.push(tw);
          added++;
        }
      }
      pageMeta.push({ page, ok: true, returned: parsed.tweets.length, added, durMs, hasNext: !!parsed.nextCursor });
      cursor = parsed.nextCursor;
      if (!cursor) break;
      if (page < maxPages) await delay(PAGE_DELAY_MS);
    }

    return okResult({
      feed,
      total: allTweets.length,
      tweets: allTweets,
      pages: pageMeta,
      meta: {
        bridge: 'home-bridge',
        version: VERSION,
        opName,
        queryId: meta.queryId,
        graphqlSource: meta.source || 'unknown',
        pausedOn429: pausedOnce,
        endedReason: cursor ? 'reached_max_pages' : 'no_cursor',
        path: 'api_getHome',
      },
    });
  }

  async function getHome(args){
    const gql = await api_getHome(args);
    if (gql.ok) return gql;
    const tryDom = gql.error === 'graphql_fallback' || gql.error === 'graphql_discovery_failed';
    if (tryDom) {
      const dom = await dom_getHome(args);
      if (dom.ok) return dom;
      return dom;
    }
    return gql;
  }

  const apiExport = {
    __meta: { version: VERSION, name: 'home-bridge' },
    probe,
    state,
    sessionState,
    navigateHome,
    getHome,
    api_getHome,
    dom_getHome,
  };
  window.__jse_x_home__ = apiExport;
  return { ok: true, version: VERSION, name: 'home-bridge' };
})();
