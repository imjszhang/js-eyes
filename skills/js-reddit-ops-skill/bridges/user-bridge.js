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
  const VERSION = '3.4.1';

  // @@include ./common.js

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
  };
  window.__jse_reddit_user__ = api;
  return { ok: true, version: VERSION, name: 'user-bridge' };
})();
