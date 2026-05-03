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
  const VERSION = '3.6.1';

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
    const t = ALLOWED_TABS.has(tab) ? tab : '';
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
    // reddit 偶发对自动化访问的 user 页插 reputation captcha（shreddit-async-loader[bundlename="reputation_recaptcha"]）
    // —— 等 1.5s 给页面初始化，提前检测，触发后立即 dom_unstable 让 runTool fallback api，
    // 而不是干等 9s timeout
    await new Promise(function(r){ setTimeout(r, 1500); });
    try {
      const cap = document.querySelector('shreddit-async-loader[bundlename="reputation_recaptcha"], reputation-recaptcha');
      if (cap) {
        return errResult('dom_unstable', { stage: 'captcha_blocked', detail: 'reputation_recaptcha' });
      }
    } catch (_) {}
    const waitRes = await __jseDomWaitFor(
      ['shreddit-post', 'shreddit-comment', 'article[data-post-id]'],
      { count: 1, timeoutMs: 9000 }
    );
    if (!waitRes.ok) {
      return errResult('dom_timeout', { stage: 'wait_user_items', detail: waitRes });
    }
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
    const url = `https://www.reddit.com/user/${encodeURIComponent(name)}/${tab ? tab + '/' : ''}`;
    return navigateLocation(url);
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
