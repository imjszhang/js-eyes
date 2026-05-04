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
  const VERSION = '3.7.0';

  // @@include ./common.js
  // @@include ./_dom-actions.js

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

  // ---- v3.7.0 dom-first ---------------------------------------------------

  function _buildSearchUrl(opts){
    const usp = new URLSearchParams();
    usp.set('q', opts.q);
    if (opts.sort) usp.set('sort', opts.sort);
    if (opts.t) usp.set('t', opts.t);
    if (opts.type) usp.set('type', opts.type);
    if (opts.sub && opts.restrictSr) usp.set('restrict_sr', '1');
    const path = opts.sub && opts.restrictSr ? `/r/${encodeURIComponent(opts.sub)}/search/` : '/search/';
    return 'https://www.reddit.com' + path + '?' + usp.toString();
  }

  function _onSearchPage(){
    const p = location.pathname || '';
    return p === '/search/' || p === '/search' || /^\/r\/[^/]+\/search\/?$/.test(p);
  }

  function _extractSearchPostFromShreddit(node){
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

  // 新版 reddit search 结果用 [data-testid="search-post-unit"] / [data-testid="search-sdui-post"]
  // 而不是 shreddit-post（前者是搜索专属 SDUI 容器）。从内部子节点抽 title + permalink。
  function _extractSearchPostFromUnit(node){
    if (!node) return null;
    const sub = function(sel){
      try { return node.querySelector ? node.querySelector(sel) : null; } catch (_) { return null; }
    };
    const text = function(el){ return el && el.textContent ? String(el.textContent).replace(/\s+/g, ' ').trim() : ''; };
    const linkEl = sub('a[href*="/comments/"]');
    const titleEl = sub('[data-testid="post-title-text"]') || sub('[data-testid="post-title"]') || sub('h3, h2');
    const permalink = linkEl ? (linkEl.getAttribute('href') || '') : '';
    let id = '';
    const m = /\/comments\/([a-z0-9]+)/i.exec(permalink || '');
    if (m) id = 't3_' + m[1];
    let subreddit = '';
    const sm = /\/r\/([\w-]+)\//i.exec(permalink || '');
    if (sm) subreddit = 'r/' + sm[1];
    let title = text(titleEl);
    if (!title && linkEl) title = text(linkEl);
    if (!title) return null;
    return {
      id: id || null,
      kind: 't3',
      title,
      subreddit,
      permalink: permalink || null,
      contentHref: permalink ? ('https://www.reddit.com' + permalink) : null,
      _domSource: 'search-post-unit',
    };
  }

  async function _typeIntoSearchInput(q){
    // 多 fallback：shreddit faceplate-search-input → header search input → mobile search
    const sel = [
      '#main-search-input input',
      'faceplate-search-input input',
      'shreddit-app-search input',
      'input[name="q"]',
      '[id*="search"][id*="input"] input',
    ];
    const found = await __jseDomLocate(sel, { optional: true });
    if (!found || !found.el) return { ok: false, error: 'dom_not_found' };
    return await __jseDomType(found.el, q, { perCharMs: 55, clear: true });
  }

  async function dom_search(args){
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

    const targetUrl = _buildSearchUrl({ q, sort, t, type, sub, restrictSr });
    const onSearch = _onSearchPage();
    const curParams = parseSearchParams();
    const queryMatches = onSearch && (curParams.q || '').trim().toLowerCase() === q.toLowerCase();
    if (!queryMatches) {
      // 演示打字效果（不阻塞导航）：在当前页找到 search input 即逐字打字
      try { await _typeIntoSearchInput(q); } catch (_) {}
      __jseDomEmitNavigateIntent(targetUrl);
      return errResult('dom_navigation_required', {
        to: targetUrl,
        navMethod: 'navigateSearch',
        navArgs: { q, sort, t, type, sub, restrictSr, clear: false },
        retry: true,
      });
    }

    const t0 = Date.now();
    // 新 reddit 搜索结果用 SDUI testid 容器；老 shreddit-post 作为 fallback
    const waitSel = type === 'sr'
      ? ['shreddit-subreddit', 'shreddit-search-subreddit-card', '[data-testid="search-community-card"]', 'a[href^="/r/"]']
      : type === 'user'
      ? ['shreddit-profile', 'shreddit-search-profile-card', '[data-testid="search-profile-card"]', 'a[href^="/user/"]']
      : ['[data-testid="search-post-unit"]', '[data-testid="search-sdui-post"]', '[data-testid="post-title"]', 'shreddit-post', 'article[data-post-id]'];
    const waitRes = await __jseDomWaitFor(waitSel, { count: 1, timeoutMs: 10000 });
    if (!waitRes.ok) {
      return errResult('dom_timeout', { stage: 'wait_results', detail: waitRes });
    }

    // 根据 selector 决定 extract 函数（新 testid 容器 vs 老 shreddit-post）
    const useUnit = waitRes.selector.indexOf('search-post-unit') >= 0
      || waitRes.selector.indexOf('search-sdui-post') >= 0
      || waitRes.selector.indexOf('post-title') >= 0;
    const extractFn = useUnit ? _extractSearchPostFromUnit : _extractSearchPostFromShreddit;
    const ext = __jseDomExtract(
      useUnit
        ? ['[data-testid="search-post-unit"]', '[data-testid="search-sdui-post"]', '[data-testid="post-title"]']
        : [waitRes.selector, 'shreddit-post', 'article[data-post-id]'],
      extractFn,
      { limit }
    );
    if (!ext.ok) {
      return errResult('dom_extract_failed', { stage: 'extract_results', detail: ext });
    }
    const items = ext.items.slice(0, limit);
    const fetchDurationMs = Date.now() - t0;
    return okResult({
      q,
      sort,
      t,
      type: type || 'link',
      sub: sub || null,
      restrictSr,
      requestedLimit: limit,
      returnedCount: items.length,
      items,
      meta: {
        bridge: 'search-bridge',
        version: VERSION,
        endpoint: location.href,
        fetchDurationMs,
        domSelector: ext.selector,
        truncated: items.length >= limit,
        source: 'dom',
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
    dom_search,
  };
  // v3.7.0 dom-first：所有公开方法暴露 api_* 前缀别名（runTool dispatch 优先尝试 api_<name>）
  for (const k of Object.keys(api)) {
    if (k === '__meta' || k.indexOf('api_') === 0 || k.indexOf('dom_') === 0) continue;
    if (typeof api[k] === 'function') api['api_' + k] = api[k];
  }
  window.__jse_reddit_search__ = api;
  return { ok: true, version: VERSION, name: 'search-bridge' };
})();
