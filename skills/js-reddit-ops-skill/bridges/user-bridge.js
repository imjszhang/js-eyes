// bridges/user-bridge.js
// ---------------------------------------------------------------------------
// Reddit 用户主页 bridge。
//
// 暴露 window.__jse_reddit_user__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   userProfile({ name?, tab?, sort?, t?, limit?, after? })
//
// tab ∈ {overview, submitted, comments, saved, upvoted, downvoted, gilded, hidden}
// 后四个需要登录且仅自己可见。本 bridge 只读，不做关注/拉黑等写操作。
// ---------------------------------------------------------------------------

(function install(){
  'use strict';
  const VERSION = '3.6.3';

  // @@include ./common.js
  // @@include ./_dom-actions.js

  const DEFAULT_LIMIT = 25;
  const MAX_LIMIT = 100;
  const ALLOWED_TABS = new Set(['overview', 'submitted', 'comments', 'saved', 'upvoted', 'downvoted', 'gilded', 'hidden']);
  const ALLOWED_SORTS = new Set(['new', 'hot', 'top', 'controversial']);
  const ALLOWED_T = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);

  function parseUserFromPath(){
    const m = /^\/user\/([\w-]+)(?:\/([\w-]+))?\/?/.exec(location.pathname || '');
    if (!m) return { name: null, tab: null };
    return { name: m[1], tab: m[2] && ALLOWED_TABS.has(m[2]) ? m[2] : null };
  }

  function normalizeUserItem(child){
    if (!child) return null;
    if (child.kind === 't3') return normalizePostListingItem(child);
    if (child.kind === 't1') return normalizeCommentListingItem(child);
    return null;
  }

  async function probe(){
    const u = parseUserFromPath();
    const frontend = detectFrontend();
    let me = { loggedIn: false };
    try { me = await readMeViaApi(false); } catch (_) {}
    let about = null;
    if (u.name) {
      try {
        const resp = await fetchRedditJson(`/user/${u.name}/about.json`);
        if (resp.ok && resp.data && resp.data.data) {
          const d = resp.data.data;
          about = {
            name: d.name || u.name,
            totalKarma: typeof d.total_karma === 'number' ? d.total_karma : null,
            linkKarma: typeof d.link_karma === 'number' ? d.link_karma : null,
            commentKarma: typeof d.comment_karma === 'number' ? d.comment_karma : null,
            createdUtc: unixToIso(d.created_utc),
            isMod: !!d.is_mod,
            isGold: !!d.is_gold,
          };
        }
      } catch (_) {}
    }
    return okResult({
      url: location.href,
      frontend,
      user: u,
      about,
      login: { api: me, dom: readLoginStateDom(), loggedIn: !!(me.loggedIn || readLoginStateDom().loggedIn) },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'user-bridge' },
    });
  }

  async function state(){
    const u = parseUserFromPath();
    return okResult({
      ready: !!u.name,
      reason: u.name ? null : 'not_on_user_page',
      url: location.href,
      user: u,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function userProfile(args){
    args = args || {};
    const fromPath = parseUserFromPath();
    const name = String(args.name || fromPath.name || '').trim();
    if (!name) return errResult('missing_user_name');
    const rawTab = String(args.tab || fromPath.tab || 'overview').toLowerCase();
    const tab = ALLOWED_TABS.has(rawTab) ? rawTab : 'overview';
    const rawSort = String(args.sort || 'new').toLowerCase();
    const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : 'new';
    const rawT = String(args.t || 'all').toLowerCase();
    const t = ALLOWED_T.has(rawT) ? rawT : 'all';
    const limit = clampLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const after = args.after ? String(args.after) : null;

    const path = `/user/${name}/${tab}.json`;
    const params = { sort, t, limit };
    if (after) params.after = after;
    const t0 = Date.now();
    const [resp, aboutResp] = await Promise.all([
      fetchRedditJson(path, params, { textLimit: 2048 }),
      fetchRedditJson(`/user/${name}/about.json`).catch(() => null),
    ]);
    const fetchDurationMs = Date.now() - t0;
    if (!resp.ok || !resp.data || resp.data._nonJson) {
      return errResult('fetch_failed', { httpStatus: resp.httpStatus, url: resp.url, hint: ['saved', 'upvoted', 'downvoted', 'hidden'].includes(tab) ? 'tab requires login as the same user' : null });
    }
    const summary = summarizeListing(resp.data, { normalize: normalizeUserItem });
    let about = null;
    if (aboutResp && aboutResp.ok && aboutResp.data && aboutResp.data.data) {
      const d = aboutResp.data.data;
      about = {
        name: d.name || name,
        totalKarma: typeof d.total_karma === 'number' ? d.total_karma : null,
        linkKarma: typeof d.link_karma === 'number' ? d.link_karma : null,
        commentKarma: typeof d.comment_karma === 'number' ? d.comment_karma : null,
        createdUtc: unixToIso(d.created_utc),
        isMod: !!d.is_mod,
        isGold: !!d.is_gold,
      };
    }
    return okResult({
      name,
      tab,
      sort,
      t,
      requestedLimit: limit,
      about,
      ...summary,
      meta: {
        bridge: 'user-bridge',
        version: VERSION,
        endpoint: resp.url,
        httpStatus: resp.httpStatus,
        fetchDurationMs,
        truncated: summary.returnedCount >= limit,
      },
    });
  }

  // ---- v3.7.0 dom-first ----------------------------------------------------

  function _targetUserUrl(name, tab){
    // v3.6.2：reddit 新版 web 已废弃 /user/<name>/overview/ 路径，访问会 404。
    // overview 现在等同于默认 user 主页 /user/<name>/，所以这里把 'overview' 映射成
    // 空 subpath。其它 tab（submitted/comments/saved/...）保持子路径。
    const t = (ALLOWED_TABS.has(tab) && tab !== 'overview') ? tab : '';
    return `https://www.reddit.com/user/${encodeURIComponent(name)}/${t ? t + '/' : ''}`;
  }

  function _extractUserItemDom(node){
    if (!node) return null;
    const tag = String(node.tagName || '').toLowerCase();
    const get = function(name){
      try { return node.getAttribute ? node.getAttribute(name) : null; } catch (_) { return null; }
    };
    const num = function(v){ const n = Number(v); return Number.isFinite(n) ? n : null; };
    if (tag === 'shreddit-post') {
      const id = get('id') || get('post-id') || '';
      if (!id && !get('post-title')) return null;
      return {
        id: id || null,
        kind: 't3',
        title: get('post-title') || '',
        score: num(get('score')),
        subreddit: get('subreddit-prefixed-name') || '',
        createdAt: get('created-timestamp') || null,
        permalink: get('permalink') || null,
        _domSource: 'shreddit-post',
      };
    }
    if (tag === 'shreddit-comment') {
      const bodyEl = node.querySelector('[slot="comment"]');
      const body = bodyEl && bodyEl.textContent ? String(bodyEl.textContent).replace(/\s+/g, ' ').trim().slice(0, 400) : '';
      return {
        id: get('thingid') || get('id') || null,
        kind: 't1',
        score: num(get('score')),
        body,
        createdAt: get('created-timestamp') || null,
        _domSource: 'shreddit-comment',
      };
    }
    return null;
  }

  async function dom_userProfile(args){
    args = args || {};
    const fromPath = parseUserFromPath();
    const name = String(args.name || fromPath.name || '').trim();
    if (!name) return errResult('missing_user_name');
    const rawTab = String(args.tab || fromPath.tab || 'overview').toLowerCase();
    const tab = ALLOWED_TABS.has(rawTab) ? rawTab : 'overview';
    const limit = clampLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const targetUrl = _targetUserUrl(name, tab);

    const onTarget = fromPath.name && fromPath.name.toLowerCase() === name.toLowerCase()
      && (!fromPath.tab || fromPath.tab === tab || (tab === 'overview' && !fromPath.tab));
    if (!onTarget) {
      __jseDomEmitNavigateIntent(targetUrl);
      return errResult('dom_navigation_required', {
        to: targetUrl,
        navMethod: 'navigateUser',
        navArgs: { name, tab },
        retry: true,
      });
    }

    const t0 = Date.now();
    // v3.6.2：reddit 新版 web 对废弃路径（如 /overview/）直接渲染 404 ("Page not found")。
    // 这种情况返回 dom_navigation_required 让 runTool 重新导到正确 URL（_targetUserUrl
    // 已经把 'overview' 映射成空 subpath）。
    try {
      const bodyText = (document.body && document.body.innerText) || '';
      if (/Page not found/i.test(bodyText) && !document.querySelector('shreddit-feed')) {
        __jseDomEmitNavigateIntent(targetUrl);
        return errResult('dom_navigation_required', {
          to: targetUrl,
          navMethod: 'navigateUser',
          navArgs: { name, tab },
          retry: true,
          reason: 'page_404',
        });
      }
    } catch (_) {}
    // reddit 偶发对自动化访问的 user 页插 reputation captcha。注意：
    // shreddit-async-loader[bundlename="reputation_recaptcha"] 这个 stub 元素是
    // **每个 user 页都常驻的占位**（rect 0×0），不能光看存在与否——必须看它有没有
    // 真渲染（rect.height>20）或有真 iframe 才算 captcha 实际触发。否则 v3.6.1
    // 老逻辑会对每个 user 页都误判 captcha_blocked、把 dom 路径直接关掉。
    await new Promise(function(r){ setTimeout(r, 800); });
    try {
      const stubs = document.querySelectorAll('shreddit-async-loader[bundlename="reputation_recaptcha"], reputation-recaptcha');
      let realCaptcha = false;
      for (const el of stubs) {
        let r = null;
        try { r = el.getBoundingClientRect(); } catch (_) {}
        const visible = r && (r.height > 20 || r.width > 20);
        const hasIframe = !!el.querySelector('iframe');
        const loaded = el.getAttribute && el.getAttribute('loaded');
        if (visible || hasIframe || (loaded && loaded !== 'false')) { realCaptcha = true; break; }
      }
      if (realCaptcha) {
        return errResult('dom_unstable', { stage: 'captcha_blocked', detail: 'reputation_recaptcha' });
      }
    } catch (_) {}
    // empty profile 早退：reddit 给空账号 / 空 tab 渲染 #empty-feed-content，
    // 不必再等 9s timeout——直接返回 ok+returnedCount=0。
    try {
      if (document.querySelector('shreddit-feed #empty-feed-content, [id="empty-feed-content"]')) {
        return okResult({
          name,
          tab,
          sort: args.sort || 'new',
          t: args.t || 'all',
          requestedLimit: limit,
          returnedCount: 0,
          items: [],
          meta: {
            bridge: 'user-bridge',
            version: VERSION,
            endpoint: location.href,
            fetchDurationMs: Date.now() - t0,
            domSelector: 'empty-feed-content',
            truncated: false,
            source: 'dom',
            empty: true,
          },
        });
      }
    } catch (_) {}
    const waitRes = await __jseDomWaitFor(
      ['shreddit-post', 'shreddit-comment', 'article[data-post-id]', 'shreddit-feed #empty-feed-content'],
      { count: 1, timeoutMs: 9000 }
    );
    if (!waitRes.ok) {
      return errResult('dom_timeout', { stage: 'wait_user_items', detail: waitRes });
    }
    // wait 命中 empty marker 也走空回退
    try {
      if (document.querySelector('shreddit-feed #empty-feed-content, [id="empty-feed-content"]')) {
        return okResult({
          name,
          tab,
          sort: args.sort || 'new',
          t: args.t || 'all',
          requestedLimit: limit,
          returnedCount: 0,
          items: [],
          meta: {
            bridge: 'user-bridge',
            version: VERSION,
            endpoint: location.href,
            fetchDurationMs: Date.now() - t0,
            domSelector: 'empty-feed-content',
            truncated: false,
            source: 'dom',
            empty: true,
          },
        });
      }
    } catch (_) {}
    const ext = __jseDomExtract(
      ['shreddit-post, shreddit-comment'],
      _extractUserItemDom,
      { limit }
    );
    if (!ext.ok) {
      return errResult('dom_extract_failed', { stage: 'extract_user_items', detail: ext });
    }
    const items = ext.items.slice(0, limit);
    const fetchDurationMs = Date.now() - t0;
    return okResult({
      name,
      tab,
      sort: args.sort || 'new',
      t: args.t || 'all',
      requestedLimit: limit,
      returnedCount: items.length,
      items,
      meta: {
        bridge: 'user-bridge',
        version: VERSION,
        endpoint: location.href,
        fetchDurationMs,
        domSelector: ext.selector,
        truncated: items.length >= limit,
        source: 'dom',
      },
    });
  }

  function navigateUser(args){
    args = args || {};
    const fromPath = parseUserFromPath();
    const name = String(args.name || fromPath.name || '').trim();
    if (!name) return errResult('missing_user_name');
    const tab = args.tab && ALLOWED_TABS.has(String(args.tab).toLowerCase()) ? String(args.tab).toLowerCase() : '';
    // v3.6.2：复用 _targetUserUrl 的映射逻辑（'overview' → 默认 user 页，
    // 因为 reddit 新版 web 已废弃 /overview/ 路径，会 404）
    return navigateLocation(_targetUserUrl(name, tab));
  }

  const api = {
    __meta: { version: VERSION, name: 'user-bridge' },
    probe,
    state,
    sessionState,
    userProfile,
    navigateUser,
    dom_userProfile,
  };
  for (const k of Object.keys(api)) {
    if (k === '__meta' || k.indexOf('api_') === 0 || k.indexOf('dom_') === 0) continue;
    if (typeof api[k] === 'function') api['api_' + k] = api[k];
  }
  window.__jse_reddit_user__ = api;
  return { ok: true, version: VERSION, name: 'user-bridge' };
})();
