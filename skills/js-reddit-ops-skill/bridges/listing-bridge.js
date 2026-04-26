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
  const VERSION = '3.4.1';

  // @@include ./common.js

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
  };
  window.__jse_reddit_listing__ = api;
  return { ok: true, version: VERSION, name: 'listing-bridge' };
})();
