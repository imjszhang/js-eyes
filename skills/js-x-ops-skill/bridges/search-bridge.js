// bridges/search-bridge.js
// ---------------------------------------------------------------------------
// X.com 搜索结果 bridge。
//
// 暴露 window.__jse_x_search__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   navigateSearch({ keyword, sort?, ... })
//   search({ keyword, sort?, maxPages?, since?, until?, minLikes?, ... })
//
// 主要走 GraphQL SearchTimeline；遇到 429 连续 3 次暂停 5 分钟（与 v2 行为一致）。
// ---------------------------------------------------------------------------

(function install(){
  'use strict';
  const VERSION = '3.0.4';

  // @@include ./common.js

  const ALLOWED_SORTS = new Set(['top', 'latest', 'media']);
  const DEFAULT_MAX_PAGES = 5;
  const MAX_MAX_PAGES = 50;
  const PAGE_DELAY_MS = 2000;
  const PAUSE_AFTER_429_MS = 5 * 60 * 1000;
  const SCROLL_DELAY_MS = 1500;
  const SCROLL_NO_NEW_THRESHOLD = 2;
  // v3.0.4：恢复 GraphQL 主路径，4xx/error 自动降级到 DOM。
  const ENABLE_GRAPHQL = true;

  function isOnSearchPath(){
    try { return /^\/search(?:\/|\?|$)/i.test(location.pathname || ''); }
    catch (_) { return false; }
  }

  function notOnSearchPageError(detail){
    let path = '';
    let q = null;
    try {
      path = location.pathname || '';
      q = new URLSearchParams(location.search).get('q');
    } catch (_) {}
    return errResult('not_on_search_page', Object.assign({
      currentPath: path,
      currentQuery: q,
      hint: 'session 没把 tab 切到 /search?q=...；检查 lib/session.js 的 navigate verify 是否抛错',
    }, detail || {}));
  }

  /**
   * 比较"页面当前 q 参数" vs "调用方期望搜索的 keyword"。
   *
   * 这是 v3.0.4 的关键防御：当 navigateOnReuse=false 时（READ 默认行为），
   * 浏览器可能停在 q=旧关键词 的 search 页面，DOM 路径会读到错误数据。
   * 用空格、URL 编码差异容忍化比较。
   */
  function searchUrlMatches(keyword){
    if (!keyword) return false;
    try {
      const sp = new URLSearchParams(location.search);
      const q = (sp.get('q') || '').trim();
      if (!q) return false;
      const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
      return norm(q) === norm(keyword);
    } catch (_) { return false; }
  }

  function parseSearchParams(){
    try {
      const sp = new URLSearchParams(location.search);
      return {
        q: sp.get('q'),
        f: sp.get('f'),
        src: sp.get('src'),
      };
    } catch (_) { return { q: null, f: null, src: null }; }
  }

  function inferSortFromUrl(){
    try {
      const f = new URLSearchParams(location.search).get('f');
      if (f === 'live') return 'latest';
      if (f === 'image') return 'media';
      return 'top';
    } catch (_) { return 'top'; }
  }

  async function probe(){
    const params = parseSearchParams();
    const sessionResp = await sessionStateCommon();
    const dParams = await discoverGraphQLParams(['SearchTimeline']);
    return okResult({
      url: location.href,
      hostname: location.hostname,
      params,
      sortInferred: inferSortFromUrl(),
      login: sessionResp && sessionResp.data ? sessionResp.data : null,
      graphql: dParams.data,
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'search-bridge' },
    });
  }

  async function state(){
    const params = parseSearchParams();
    const ready = !!(params.q && /\/search\b/.test(location.pathname));
    return okResult({
      ready,
      reason: ready ? null : (params.q ? 'not_on_search_path' : 'no_query'),
      url: location.href,
      params,
      sort: inferSortFromUrl(),
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  function navigateSearch(args){
    args = args || {};
    const keyword = String(args.keyword || args.q || '').trim();
    if (!keyword) return errResult('missing_query');
    const url = buildXSearchUrl({
      keyword,
      sort: args.sort || 'top',
      from: args.from, to: args.to,
      since: args.since, until: args.until,
      lang: args.lang,
      minLikes: args.minLikes, minRetweets: args.minRetweets, minReplies: args.minReplies,
      excludeReplies: args.excludeReplies, excludeRetweets: args.excludeRetweets,
      hasLinks: args.hasLinks,
    });
    return navigateLocation(url);
  }

  function _extractTweetsFromDom(seenIds){
    const found = [];
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    articles.forEach(function(article){
      try {
        const tw = parseTweetArticle(article);
        if (tw && tw.tweetId && !seenIds.has(tw.tweetId)) {
          seenIds.add(tw.tweetId);
          found.push(tw);
        }
      } catch (_) {}
    });
    return found;
  }

  async function searchViaDom(opts){
    if (!isOnSearchPath()) return notOnSearchPageError({ stage: 'enter_search_via_dom' });
    const keyword = opts.keyword;
    if (!searchUrlMatches(keyword)) {
      // v3.0.4：DOM 路径硬约束 —— q 参数必须等于本次 keyword。
      // 否则 navigateOnReuse=false 时会把"旧关键词页面"的推文当成"新关键词"返回。
      return notOnSearchPageError({
        stage: 'enter_search_via_dom',
        keyword,
        reason: 'q_param_mismatch',
        hint: '当前 tab 的 q 参数 != 本次搜索的 keyword；要么先调 x_navigate_search 切页，要么用 navigateOnReuse=true 让 session 自动切 tab',
      });
    }
    const sort = opts.sort;
    const fullQuery = opts.fullQuery;
    const maxPages = opts.maxPages;
    const allTweets = [];
    const seenIds = new Set();
    const pageMeta = [];
    const t0Total = Date.now();

    let contentReady = false;
    for (let i = 0; i < 10; i++) {
      const count = document.querySelectorAll('article[data-testid="tweet"]').length;
      if (count > 0) { contentReady = true; break; }
      await delay(1000);
    }
    if (!contentReady) {
      if (!isOnSearchPath()) return notOnSearchPageError({ stage: 'wait_for_articles' });
      return errResult('content_not_ready', { hint: 'no_tweet_articles_in_dom' });
    }

    const initial = _extractTweetsFromDom(seenIds);
    for (const tw of initial) allTweets.push(tw);
    pageMeta.push({ page: 1, ok: true, returned: initial.length, added: initial.length, scrollRound: 0 });

    const maxScrollRounds = Math.max(1, Math.min((maxPages | 0), 50));
    let noNewCount = 0;
    for (let round = 1; round <= maxScrollRounds; round++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await delay(SCROLL_DELAY_MS);
      const more = _extractTweetsFromDom(seenIds);
      for (const tw of more) allTweets.push(tw);
      pageMeta.push({ page: round + 1, ok: true, returned: more.length, added: more.length, scrollRound: round });
      if (more.length === 0) {
        noNewCount++;
        if (noNewCount >= SCROLL_NO_NEW_THRESHOLD) break;
      } else {
        noNewCount = 0;
      }
    }

    return okResult({
      keyword,
      sort,
      product: sortToProduct(sort),
      fullQuery,
      total: allTweets.length,
      tweets: allTweets,
      pages: pageMeta,
      meta: {
        bridge: 'search-bridge',
        version: VERSION,
        opName: 'DOM_EXTRACT',
        graphqlEnabled: ENABLE_GRAPHQL,
        durationMs: Date.now() - t0Total,
        endedReason: 'dom_extracted',
      },
    });
  }

  async function search(args){
    args = args || {};
    const keyword = String(args.keyword || args.q || '').trim();
    if (!keyword) return errResult('missing_query');
    if (!isOnSearchPath()) return notOnSearchPageError();
    const sortRaw = String(args.sort || 'top').toLowerCase();
    const sort = ALLOWED_SORTS.has(sortRaw) ? sortRaw : 'top';
    const product = sortToProduct(sort);
    const maxPages = clampLimit(args.maxPages, DEFAULT_MAX_PAGES, MAX_MAX_PAGES);
    const fullQuery = (function(){
      const o = {
        keyword, sort,
        from: args.from, to: args.to,
        since: args.since, until: args.until,
        lang: args.lang,
        minLikes: args.minLikes, minRetweets: args.minRetweets, minReplies: args.minReplies,
        excludeReplies: args.excludeReplies, excludeRetweets: args.excludeRetweets,
        hasLinks: args.hasLinks,
      };
      const ops = [];
      if (o.from) ops.push('from:' + o.from);
      if (o.to) ops.push('to:' + o.to);
      if (o.since) ops.push('since:' + o.since);
      if (o.until) ops.push('until:' + o.until);
      if (o.lang) ops.push('lang:' + o.lang);
      if (typeof o.minLikes === 'number' && o.minLikes > 0) ops.push('min_faves:' + o.minLikes);
      if (typeof o.minRetweets === 'number' && o.minRetweets > 0) ops.push('min_retweets:' + o.minRetweets);
      if (typeof o.minReplies === 'number' && o.minReplies > 0) ops.push('min_replies:' + o.minReplies);
      if (o.excludeReplies) ops.push('-filter:replies');
      if (o.excludeRetweets) ops.push('-filter:retweets');
      if (o.hasLinks) ops.push('filter:links');
      return ops.length ? (keyword + ' ' + ops.join(' ')).trim() : keyword;
    })();

    if (!ENABLE_GRAPHQL) {
      return await searchViaDom({ keyword, sort, fullQuery, maxPages });
    }

    let disc = await discoverGraphQLParams(['SearchTimeline']);
    let meta = (disc.data && disc.data.SearchTimeline) || null;
    if (!meta || !meta.queryId) {
      return await searchViaDom({ keyword, sort, fullQuery, maxPages });
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
        : { rawQuery: fullQuery, count: 20, querySource: 'typed_query', product };
      variables.rawQuery = fullQuery;
      variables.product = product;
      if (!variables.count) variables.count = 20;
      if (!variables.querySource) variables.querySource = 'typed_query';
      if (cursor) variables.cursor = cursor; else delete variables.cursor;

      const t0 = Date.now();
      const resp = await fetchXGraphQL({
        opName: 'SearchTimeline',
        queryId: meta.queryId,
        variables,
        features,
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
        const retryDelay = (resp.retryAfter || 30) * 1000;
        await delay(Math.min(retryDelay, 60 * 1000));
        page--;
        continue;
      }
      if (!resp.ok && (resp.statusCode === 400 || resp.statusCode === 404) && !cacheInvalidated) {
        cacheInvalidated = true;
        invalidateGraphQLCache('SearchTimeline');
        disc = await discoverGraphQLParams(['SearchTimeline']);
        const newMeta = (disc.data && disc.data.SearchTimeline) || null;
        if (newMeta && newMeta.queryId) {
          meta = newMeta;
          features = newMeta.features || features;
          variablesTemplate = newMeta.variables || variablesTemplate;
          page--;
          continue;
        }
      }
      if (!resp.ok) {
        if (page === 1 && (resp.statusCode === 400 || resp.statusCode === 404)) {
          return await searchViaDom({ keyword, sort, fullQuery, maxPages });
        }
        pageMeta.push({ page, ok: false, error: resp.error, statusCode: resp.statusCode || null, durMs });
        break;
      }
      consecutive429 = 0;

      let entries = [];
      try {
        const ins = (resp.data && resp.data.data && resp.data.data.search_by_raw_query
          && resp.data.data.search_by_raw_query.search_timeline
          && resp.data.data.search_by_raw_query.search_timeline.timeline
          && resp.data.data.search_by_raw_query.search_timeline.timeline.instructions) || [];
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
      keyword,
      sort,
      product,
      fullQuery,
      total: allTweets.length,
      tweets: allTweets,
      pages: pageMeta,
      meta: {
        bridge: 'search-bridge',
        version: VERSION,
        opName: 'SearchTimeline',
        queryId: meta.queryId,
        graphqlSource: meta.source || 'unknown',
        pausedOn429: pausedOnce,
        endedReason: cursor ? 'reached_max_pages' : 'no_cursor',
      },
    });
  }

  const api = {
    __meta: { version: VERSION, name: 'search-bridge' },
    probe,
    state,
    sessionState,
    navigateSearch,
    search,
  };
  window.__jse_x_search__ = api;
  return { ok: true, version: VERSION, name: 'search-bridge' };
})();
