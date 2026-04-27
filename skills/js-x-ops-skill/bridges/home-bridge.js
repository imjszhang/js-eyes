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
  const VERSION = '3.0.2';

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

  function navigateHome(args){
    args = args || {};
    const feed = args.feed && ALLOWED_FEEDS.has(String(args.feed).toLowerCase())
      ? String(args.feed).toLowerCase()
      : 'foryou';
    return navigateLocation('https://x.com/home');
  }

  async function getHome(args){
    args = args || {};
    const feedRaw = String(args.feed || inferFeedFromPath()).toLowerCase();
    const feed = ALLOWED_FEEDS.has(feedRaw) ? feedRaw : 'foryou';
    const maxPages = clampLimit(args.maxPages, DEFAULT_MAX_PAGES, MAX_MAX_PAGES);
    const opName = feedToOp(feed);

    let disc = await discoverGraphQLParams([opName]);
    let meta = disc.data && disc.data[opName];
    if (!meta || !meta.queryId) {
      return errResult('graphql_discover_failed', { opName });
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
      },
    });
  }

  const api = {
    __meta: { version: VERSION, name: 'home-bridge' },
    probe,
    state,
    sessionState,
    navigateHome,
    getHome,
  };
  window.__jse_x_home__ = api;
  return { ok: true, version: VERSION, name: 'home-bridge' };
})();
