// bridges/search-bridge.js
// ---------------------------------------------------------------------------
// Reddit 搜索结果 bridge。
//
// 暴露 window.__jse_reddit_search__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   search({ q, sort?, t?, restrictSr?, sub?, type?, limit?, after? })
//
// reddit 公开 search.json 默认返回 t3（链接）listing；type 可指定 link|sr|user。
// 当 sub 提供时，自动走 /r/<sub>/search.json + restrict_sr=on 保证只在当前 sub 内搜。
// ---------------------------------------------------------------------------

(function install(){
  'use strict';
  const VERSION = '3.4.1';

  // @@include ./common.js

  const DEFAULT_LIMIT = 25;
  const MAX_LIMIT = 100;
  const ALLOWED_SORTS = new Set(['relevance', 'hot', 'top', 'new', 'comments']);
  const ALLOWED_T = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);
  const ALLOWED_TYPES = new Set(['link', 'sr', 'user']);

  function parseSubFromPath(){
    const m = /^\/r\/([\w-]+)\/search/.exec(location.pathname || '');
    return m ? m[1] : null;
  }

  function parseSearchParams(){
    try {
      const sp = new URLSearchParams(location.search);
      return {
        q: sp.get('q'),
        sort: sp.get('sort'),
        t: sp.get('t'),
        restrictSr: sp.get('restrict_sr'),
        type: sp.get('type'),
      };
    } catch (_) { return { q: null, sort: null, t: null, restrictSr: null, type: null }; }
  }

  async function probe(){
    const sub = parseSubFromPath();
    const params = parseSearchParams();
    const frontend = detectFrontend();
    let me = { loggedIn: false };
    try { me = await readMeViaApi(false); } catch (_) {}
    return okResult({
      url: location.href,
      frontend,
      sub,
      params,
      login: { api: me, dom: readLoginStateDom(), loggedIn: !!(me.loggedIn || readLoginStateDom().loggedIn) },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'search-bridge' },
    });
  }

  async function state(){
    const sub = parseSubFromPath();
    const params = parseSearchParams();
    const ready = !!params.q;
    return okResult({
      ready,
      reason: ready ? null : 'no_query',
      url: location.href,
      sub,
      params,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function search(args){
    args = args || {};
    const fromUrl = parseSearchParams();
    const q = String(args.q != null && args.q !== '' ? args.q : (fromUrl.q || '')).trim();
    if (!q) return errResult('missing_query');
    const rawSort = String(args.sort != null ? args.sort : (fromUrl.sort || 'relevance')).toLowerCase();
    const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : 'relevance';
    const rawT = String(args.t != null ? args.t : (fromUrl.t || 'all')).toLowerCase();
    const t = ALLOWED_T.has(rawT) ? rawT : 'all';
    const rawType = args.type != null ? String(args.type).toLowerCase() : null;
    const type = rawType && ALLOWED_TYPES.has(rawType) ? rawType : null;
    const sub = (args.sub && String(args.sub).trim()) || parseSubFromPath();
    const restrictSr = args.restrictSr != null ? !!args.restrictSr : !!sub;
    const limit = clampLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const after = args.after ? String(args.after) : null;

    const path = sub && restrictSr ? `/r/${sub}/search.json` : '/search.json';
    const params = { q, sort, t, limit };
    if (sub && restrictSr) params.restrict_sr = 'on';
    if (type) params.type = type;
    if (after) params.after = after;

    const t0 = Date.now();
    const resp = await fetchRedditJson(path, params, { textLimit: 2048 });
    const fetchDurationMs = Date.now() - t0;
    if (!resp.ok || !resp.data || resp.data._nonJson) {
      return errResult('fetch_failed', { httpStatus: resp.httpStatus, url: resp.url });
    }

    let normalize = normalizePostListingItem;
    if (type === 'sr') {
      normalize = function(child){
        if (!child || child.kind !== 't5') return null;
        const d = child.data || {};
        return {
          id: d.name || (d.id ? 't5_' + d.id : ''),
          kind: 't5',
          name: d.display_name || '',
          prefixed: d.display_name_prefixed || ('r/' + (d.display_name || '')),
          title: d.title || '',
          publicDescription: d.public_description || '',
          subscribers: typeof d.subscribers === 'number' ? d.subscribers : null,
          over18: !!d.over18,
          url: d.url ? ('https://www.reddit.com' + d.url) : '',
        };
      };
    } else if (type === 'user') {
      normalize = function(child){
        if (!child || child.kind !== 't2') return null;
        const d = child.data || {};
        return {
          id: d.name || (d.id ? 't2_' + d.id : ''),
          kind: 't2',
          name: d.name || '',
          totalKarma: typeof d.total_karma === 'number' ? d.total_karma : null,
          createdUtc: unixToIso(d.created_utc),
          isMod: !!d.is_mod,
          isGold: !!d.is_gold,
          subreddit: d.subreddit && d.subreddit.display_name ? d.subreddit.display_name : null,
        };
      };
    }

    const summary = summarizeListing(resp.data, { normalize });
    return okResult({
      q,
      sort,
      t,
      type: type || 'link',
      sub: sub || null,
      restrictSr,
      requestedLimit: limit,
      ...summary,
      meta: {
        bridge: 'search-bridge',
        version: VERSION,
        endpoint: resp.url,
        httpStatus: resp.httpStatus,
        fetchDurationMs,
        truncated: summary.returnedCount >= limit,
      },
    });
  }

  function navigateSearch(args){
    args = args || {};
    if (args.clear === true && !args.q) {
      return navigateLocation('https://www.reddit.com/search/');
    }
    const q = String(args.q || '').trim();
    if (!q) return errResult('missing_query');
    const sub = args.sub && String(args.sub).trim();
    const restrictSr = args.restrictSr != null ? !!args.restrictSr : !!sub;
    const usp = new URLSearchParams();
    usp.set('q', q);
    if (args.sort && ALLOWED_SORTS.has(String(args.sort).toLowerCase())) usp.set('sort', String(args.sort).toLowerCase());
    if (args.t && ALLOWED_T.has(String(args.t).toLowerCase())) usp.set('t', String(args.t).toLowerCase());
    if (args.type && ALLOWED_TYPES.has(String(args.type).toLowerCase())) usp.set('type', String(args.type).toLowerCase());
    if (sub && restrictSr) usp.set('restrict_sr', '1');
    const path = sub && restrictSr ? `/r/${encodeURIComponent(sub)}/search/` : '/search/';
    return navigateLocation('https://www.reddit.com' + path + '?' + usp.toString());
  }

  const api = {
    __meta: { version: VERSION, name: 'search-bridge' },
    probe,
    state,
    sessionState,
    search,
    navigateSearch,
  };
  window.__jse_reddit_search__ = api;
  return { ok: true, version: VERSION, name: 'search-bridge' };
})();
