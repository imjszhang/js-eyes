// bridges/listing-bridge.js
// ---------------------------------------------------------------------------
// Reddit subreddit 列表页 bridge。
//
// 暴露 window.__jse_reddit_listing__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   listSubreddit({ sub?, sort?, t?, limit?, after?, before? })
//   subredditAbout({ sub? })
//
// 所有 GET 走 reddit 公开 JSON 端点；返回项使用 normalizePostListingItem 标准化；
// 列表带 limit/after/returnedCount，便于 AI 端做大响应保护。
// ---------------------------------------------------------------------------

(function install(){
  'use strict';
  const VERSION = '3.6.0';

  // @@include ./common.js
  // @@include ./_dom-actions.js

  const DEFAULT_LIMIT = 25;
  const MAX_LIMIT = 100;
  const ALLOWED_SORTS = new Set(['hot', 'new', 'top', 'rising', 'controversial', 'best']);
  const ALLOWED_T = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);

  function parseSubFromPath(){
    const m = /^\/r\/([\w-]+)(?:\/|$)/.exec(location.pathname || '');
    return m ? m[1] : null;
  }

  function parseSortFromPath(){
    const m = /^\/r\/[^/]+\/(hot|new|top|rising|controversial|best)\/?/.exec(location.pathname || '');
    return m ? m[1] : null;
  }

  async function probe(){
    const url = location.href;
    const sub = parseSubFromPath();
    const sort = parseSortFromPath();
    const frontend = detectFrontend();
    let me = { loggedIn: false };
    try { me = await readMeViaApi(false); } catch (_) {}
    return okResult({
      url,
      frontend,
      sub,
      sort,
      login: { api: me, dom: readLoginStateDom(), loggedIn: !!(me.loggedIn || readLoginStateDom().loggedIn) },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'listing-bridge' },
    });
  }

  async function state(){
    const sub = parseSubFromPath();
    const sort = parseSortFromPath();
    return okResult({
      ready: !!sub,
      reason: sub ? null : 'not_on_subreddit_page',
      url: location.href,
      sub,
      sort,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function listSubreddit(args){
    args = args || {};
    const sub = String(args.sub || parseSubFromPath() || '').trim();
    if (!sub) return errResult('missing_subreddit', { hint: '传入 args.sub 或在 /r/<sub>/ 页面运行' });
    const rawSort = String(args.sort || parseSortFromPath() || 'hot').toLowerCase();
    const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : 'hot';
    const t = args.t && ALLOWED_T.has(String(args.t).toLowerCase()) ? String(args.t).toLowerCase() : null;
    const limit = clampLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const path = '/r/' + sub + '/' + sort + '.json';
    const params = { limit };
    if (t && (sort === 'top' || sort === 'controversial')) params.t = t;
    if (args.after) params.after = String(args.after);
    if (args.before) params.before = String(args.before);

    const t0 = Date.now();
    const resp = await fetchRedditJson(path, params, { textLimit: 2048 });
    const fetchDurationMs = Date.now() - t0;
    if (!resp.ok || !resp.data || resp.data._nonJson) {
      return errResult('fetch_failed', {
        httpStatus: resp.httpStatus || null,
        url: resp.url || null,
        body: resp.data && resp.data.text ? { text: resp.data.text, truncated: !!resp.data.truncated } : null,
      });
    }
    const summary = summarizeListing(resp.data, { normalize: normalizePostListingItem });
    return okResult({
      sub,
      sort,
      t,
      requestedLimit: limit,
      ...summary,
      meta: {
        bridge: 'listing-bridge',
        version: VERSION,
        endpoint: resp.url,
        httpStatus: resp.httpStatus,
        fetchDurationMs,
        truncated: summary.returnedCount >= limit,
      },
    });
  }

  async function subredditAbout(args){
    args = args || {};
    const sub = String(args.sub || parseSubFromPath() || '').trim();
    if (!sub) return errResult('missing_subreddit');
    const path = '/r/' + sub + '/about.json';
    const resp = await fetchRedditJson(path, null, { textLimit: 2048 });
    if (!resp.ok || !resp.data || resp.data._nonJson) {
      return errResult('fetch_failed', { httpStatus: resp.httpStatus, url: resp.url });
    }
    const d = (resp.data && resp.data.data) || {};
    return okResult({
      sub,
      data: {
        displayName: typeof d.display_name === 'string' ? d.display_name : sub,
        prefixed: typeof d.display_name_prefixed === 'string' ? d.display_name_prefixed : ('r/' + sub),
        title: typeof d.title === 'string' ? d.title : '',
        publicDescription: typeof d.public_description === 'string' ? d.public_description : '',
        descriptionHtml: typeof d.description_html === 'string' ? shortText(d.description_html, 4096).text : '',
        subscribers: typeof d.subscribers === 'number' ? d.subscribers : null,
        activeUserCount: typeof d.active_user_count === 'number' ? d.active_user_count : null,
        createdUtc: unixToIso(d.created_utc),
        over18: !!d.over18,
        lang: typeof d.lang === 'string' ? d.lang : null,
        url: typeof d.url === 'string' ? ('https://www.reddit.com' + d.url) : '',
        iconImg: typeof d.icon_img === 'string' ? d.icon_img : '',
        bannerImg: typeof d.banner_img === 'string' ? d.banner_img : '',
        subredditType: typeof d.subreddit_type === 'string' ? d.subreddit_type : null,
      },
      meta: { bridge: 'listing-bridge', version: VERSION, endpoint: resp.url },
    });
  }

  // ---- v3.7.0 dom-first ---------------------------------------------------

  function _curSubAndSort(){
    return { sub: parseSubFromPath(), sort: parseSortFromPath() };
  }

  function _targetSubUrl(sub, sort, t){
    const sortPart = ALLOWED_SORTS.has(String(sort || '').toLowerCase()) ? String(sort).toLowerCase() : '';
    let url = 'https://www.reddit.com/r/' + encodeURIComponent(sub) + '/' + (sortPart ? sortPart + '/' : '');
    const tt = t && ALLOWED_T.has(String(t).toLowerCase()) ? String(t).toLowerCase() : null;
    if (tt && (sortPart === 'top' || sortPart === 'controversial')) {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + encodeURIComponent(tt);
    }
    return url;
  }

  function _extractPostFromShreddit(node){
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
      thumbnail: get('thumbnail-url') || null,
      _domSource: 'shreddit-post',
    };
  }

  async function dom_listSubreddit(args){
    args = args || {};
    const sub = String(args.sub || parseSubFromPath() || '').trim();
    if (!sub) return errResult('missing_subreddit');
    const rawSort = String(args.sort || parseSortFromPath() || 'hot').toLowerCase();
    const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : 'hot';
    const t = args.t && ALLOWED_T.has(String(args.t).toLowerCase()) ? String(args.t).toLowerCase() : null;
    const limit = clampLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);

    const cur = _curSubAndSort();
    const subOk = (cur.sub || '').toLowerCase() === sub.toLowerCase();
    const sortOk = (cur.sort || 'hot') === sort;
    const targetUrl = _targetSubUrl(sub, sort, t);
    if (!subOk || !sortOk) {
      __jseDomEmitNavigateIntent(targetUrl);
      return errResult('dom_navigation_required', {
        to: targetUrl,
        navMethod: 'navigateSubreddit',
        navArgs: { sub, sort, t },
        retry: true,
      });
    }

    const t0 = Date.now();
    const waitRes = await __jseDomWaitFor(
      ['shreddit-post', 'article[data-post-id]', '[id^="t3_"]'],
      { count: Math.min(limit, 5), timeoutMs: 9000 }
    );
    if (!waitRes.ok) {
      return errResult('dom_timeout', { stage: 'wait_post', detail: waitRes });
    }
    const containerSelector = waitRes.selector;

    if (limit > waitRes.count && limit > 10) {
      try {
        const last = waitRes.nodes[waitRes.nodes.length - 1];
        await __jseDomScrollIntoView(last, { settleMs: 600 });
      } catch (_) {}
    }

    const ext = __jseDomExtract(
      [containerSelector, 'shreddit-post', 'article[data-post-id]'],
      _extractPostFromShreddit,
      { limit }
    );
    if (!ext.ok) {
      return errResult('dom_extract_failed', { stage: 'extract_posts', detail: ext });
    }
    const fetchDurationMs = Date.now() - t0;
    const items = ext.items.slice(0, limit);
    return okResult({
      sub,
      sort,
      t,
      requestedLimit: limit,
      returnedCount: items.length,
      items,
      meta: {
        bridge: 'listing-bridge',
        version: VERSION,
        endpoint: location.href,
        fetchDurationMs,
        domSelector: ext.selector,
        domNodeCount: ext.count,
        truncated: items.length >= limit,
        source: 'dom',
      },
    });
  }

  async function dom_subredditAbout(args){
    args = args || {};
    const sub = String(args.sub || parseSubFromPath() || '').trim();
    if (!sub) return errResult('missing_subreddit');
    const cur = _curSubAndSort();
    const subOk = (cur.sub || '').toLowerCase() === sub.toLowerCase();
    const targetUrl = 'https://www.reddit.com/r/' + encodeURIComponent(sub) + '/';
    if (!subOk) {
      __jseDomEmitNavigateIntent(targetUrl);
      return errResult('dom_navigation_required', {
        to: targetUrl,
        navMethod: 'navigateSubreddit',
        navArgs: { sub },
        retry: true,
      });
    }

    const t0 = Date.now();
    const waitRes = await __jseDomWaitFor(
      ['shreddit-subreddit-header', 'shreddit-app shreddit-subreddit-header', '[id$="-subreddit-header"]'],
      { count: 1, timeoutMs: 8000 }
    );
    if (!waitRes.ok) {
      return errResult('dom_timeout', { stage: 'wait_header', detail: waitRes });
    }
    const header = waitRes.nodes[0];
    const headerSel = waitRes.selector;
    await __jseDomLocate(headerSel);
    const get = function(node, name){
      try { return node && node.getAttribute ? node.getAttribute(name) : null; } catch (_) { return null; }
    };

    const num = function(v){ const n = Number(v); return Number.isFinite(n) ? n : null; };
    const data = {
      displayName: get(header, 'display-name') || sub,
      prefixed: get(header, 'name') || ('r/' + sub),
      title: get(header, 'title') || '',
      publicDescription: get(header, 'description') || '',
      subscribers: num(get(header, 'subscribers-count')) || num(get(header, 'subscribers')),
      activeUserCount: num(get(header, 'active-users')),
      iconImg: get(header, 'icon-img') || '',
      bannerImg: get(header, 'banner-background-image') || get(header, 'banner-img') || '',
      over18: get(header, 'over-18') === 'true' || get(header, 'over18') === 'true',
      subredditType: get(header, 'subreddit-type') || null,
      url: location.href,
    };

    const fetchDurationMs = Date.now() - t0;
    return okResult({
      sub,
      data,
      meta: {
        bridge: 'listing-bridge',
        version: VERSION,
        endpoint: location.href,
        fetchDurationMs,
        domSelector: headerSel,
        source: 'dom',
      },
    });
  }

  function navigateSubreddit(args){
    args = args || {};
    const sub = String(args.sub || parseSubFromPath() || '').trim();
    if (!sub) return errResult('missing_subreddit');
    const rawSort = args.sort != null ? String(args.sort).toLowerCase() : null;
    const sort = rawSort && ALLOWED_SORTS.has(rawSort) ? rawSort : null;
    const tail = args.about === true ? 'about/' : (sort ? sort + '/' : '');
    let url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/${tail}`;
    const t = args.t && ALLOWED_T.has(String(args.t).toLowerCase()) ? String(args.t).toLowerCase() : null;
    if (t && (sort === 'top' || sort === 'controversial')) {
      url += (url.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(t);
    }
    return navigateLocation(url);
  }

  const api = {
    __meta: { version: VERSION, name: 'listing-bridge' },
    probe,
    state,
    sessionState,
    listSubreddit,
    subredditAbout,
    navigateSubreddit,
    dom_listSubreddit,
    dom_subredditAbout,
  };
  // v3.7.0 dom-first：所有公开方法暴露 api_* 前缀别名（runTool dispatch 优先尝试 api_<name>）
  for (const k of Object.keys(api)) {
    if (k === '__meta' || k.indexOf('api_') === 0 || k.indexOf('dom_') === 0) continue;
    if (typeof api[k] === 'function') api['api_' + k] = api[k];
  }
  window.__jse_reddit_listing__ = api;
  return { ok: true, version: VERSION, name: 'listing-bridge' };
})();
