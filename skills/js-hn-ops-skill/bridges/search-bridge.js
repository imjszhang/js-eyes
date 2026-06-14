// bridges/search-bridge.js
(function install(){
  'use strict';
  const VERSION = '1.0.0';

  // @@include ./common.js

  async function probe(){
    const login = readLoginState();
    return okResult({
      url: location.href,
      login: { loggedIn: !!login.loggedIn, name: login.name, source: login.source },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'search-bridge' },
    });
  }

  async function state(){
    return okResult({
      ready: true,
      reason: null,
      url: location.href,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  function summarizeAlgoliaHit(hit){
    if (!hit || typeof hit !== 'object') return null;
    return {
      objectId: hit.objectID || null,
      title: hit.title || null,
      url: hit.url || null,
      author: hit.author || null,
      points: typeof hit.points === 'number' ? hit.points : null,
      numComments: typeof hit.num_comments === 'number' ? hit.num_comments : null,
      createdAtIso: hit.created_at || null,
      storyId: hit.story_id != null ? hit.story_id : null,
      hnUrl: hit.objectID ? 'https://news.ycombinator.com/item?id=' + hit.objectID : null,
      tags: Array.isArray(hit._tags) ? hit._tags.slice(0, 20) : [],
    };
  }

  async function api_search(args){
    args = args || {};
    const query = String(args.query || args.q || '').trim();
    if (!query) return errResult('missing_query');
    const sort = String(args.sort || 'relevance').toLowerCase();
    const pageNum = args.page != null ? Number(args.page) : 1;
    const page0 = Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) - 1 : 0;
    const hitsPerPage = clampLimit(args.limit, 20, 100);
    const params = {
      query,
      page: String(page0),
      hitsPerPage: String(hitsPerPage),
    };
    if (args.tags) params.tags = String(args.tags);
    const t0 = Date.now();
    const resp = await fetchAlgolia(sort === 'date' ? 'date' : 'relevance', params);
    if (!resp.ok || !resp.data) {
      return errResult('algolia_fetch_failed', {
        httpStatus: resp.httpStatus,
        url: resp.url,
        message: resp.message || null,
      });
    }
    const hits = Array.isArray(resp.data.hits) ? resp.data.hits.map(summarizeAlgoliaHit).filter(Boolean) : [];
    return okResult({
      query,
      sort,
      page: page0 + 1,
      limit: hitsPerPage,
      hits,
      nbHits: typeof resp.data.nbHits === 'number' ? resp.data.nbHits : null,
      meta: {
        bridge: 'search-bridge',
        version: VERSION,
        readMode: 'api',
        endpoint: resp.url,
        fetchDurationMs: Date.now() - t0,
        count: hits.length,
      },
    });
  }

  async function search(args){
    args = args || {};
    const mode = resolveReadMode(args.readMode);
    if (mode === 'dom') return errResult('dom_not_supported_for_search');
    return api_search(args);
  }

  function navigateSearch(args){
    args = args || {};
    const query = String(args.query || args.q || '').trim();
    if (!query) return errResult('missing_query');
    // HN 无同源搜索页；INTERACTIVE 仅允许 news.ycombinator.com，故打开首页并提示用 hn_search
    return navigateLocation('https://news.ycombinator.com/news');
  }

  const api = {
    __meta: { version: VERSION, name: 'search-bridge' },
    probe,
    state,
    sessionState,
    search,
    api_search,
    navigateSearch,
  };
  window.__jse_hn_search__ = api;
  return { ok: true, version: VERSION, name: 'search-bridge' };
})();
