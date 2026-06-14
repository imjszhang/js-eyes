// bridges/user-bridge.js
(function install(){
  'use strict';
  const VERSION = '1.0.0';

  // @@include ./common.js

  async function probe(){
    const userId = parseUserIdFromUrl(location.href);
    const login = readLoginState();
    return okResult({
      url: location.href,
      userId,
      login: { loggedIn: !!login.loggedIn, name: login.name, source: login.source },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'user-bridge' },
    });
  }

  async function state(){
    const userId = parseUserIdFromUrl(location.href);
    return okResult({
      ready: !!userId,
      reason: userId ? null : 'not_on_user_page',
      url: location.href,
      userId,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function api_getUser(args){
    args = args || {};
    let userId = args.userId ? String(args.userId).trim() : null;
    if (!userId) userId = parseUserIdFromUrl(args.url || location.href);
    if (!userId) return errResult('missing_user_id');
    const tab = String(args.tab || 'submitted').toLowerCase();
    const limit = clampLimit(args.limit, 30, 100);
    const t0 = Date.now();
    const resp = await fetchHnFirebase('/user/' + encodeURIComponent(userId) + '.json');
    if (!resp.ok || !resp.data || resp.data._nonJson) {
      return errResult('fetch_user_failed', {
        httpStatus: resp.httpStatus,
        url: resp.url,
      });
    }
    const profile = summarizeApiUser(resp.data);
    let itemIds = [];
    if (tab === 'comments') {
      itemIds = Array.isArray(resp.data.submitted) ? resp.data.submitted.slice(0, limit * 3) : [];
    } else {
      itemIds = Array.isArray(resp.data.submitted) ? resp.data.submitted.slice(0, limit) : [];
    }
    const rawItems = await batchFetchItems(itemIds, limit);
    let items = rawItems.map(summarizeApiItem).filter(Boolean);
    if (tab === 'comments') {
      items = items.filter((it) => it.type === 'comment').slice(0, limit);
    }
    return okResult({
      userId,
      tab,
      profile,
      items,
      meta: {
        bridge: 'user-bridge',
        version: VERSION,
        readMode: 'api',
        endpoint: resp.url,
        fetchDurationMs: Date.now() - t0,
        count: items.length,
      },
    });
  }

  async function dom_getUser(args){
    args = args || {};
    let userId = args.userId ? String(args.userId).trim() : null;
    if (!userId) userId = parseUserIdFromUrl(args.url || location.href);
    const limit = clampLimit(args.limit, 30, 100);
    const parsed = parseUserPageDom(limit);
    if (userId) parsed.profile.userId = userId;
    return okResult({
      userId: parsed.profile.userId || userId,
      tab: String(args.tab || 'submitted'),
      profile: parsed.profile,
      items: parsed.items,
      meta: {
        bridge: 'user-bridge',
        version: VERSION,
        readMode: 'dom',
        count: parsed.items.length,
      },
    });
  }

  async function getUser(args){
    args = args || {};
    const mode = resolveReadMode(args.readMode);
    if (mode === 'dom') return dom_getUser(args);
    const apiRes = await api_getUser(args);
    if (mode === 'api') return apiRes;
    if (apiRes.ok) return apiRes;
    const domRes = await dom_getUser(args);
    if (domRes.ok) {
      domRes.data.meta = Object.assign({}, domRes.data.meta, { bridgeFallbackReason: apiRes.error || 'api_failed' });
    }
    return domRes;
  }

  function navigateUser(args){
    args = args || {};
    let userId = args.userId ? String(args.userId).trim() : null;
    if (!userId) userId = parseUserIdFromUrl(args.url || '');
    if (!userId) userId = parseUserIdFromUrl(location.href);
    if (!userId) return errResult('missing_user_id');
    const tab = String(args.tab || '').toLowerCase();
    let url = 'https://news.ycombinator.com/user?id=' + encodeURIComponent(userId);
    if (tab === 'comments') url += '&sort=comments';
    return navigateLocation(url);
  }

  const api = {
    __meta: { version: VERSION, name: 'user-bridge' },
    probe,
    state,
    sessionState,
    getUser,
    api_getUser,
    dom_getUser,
    navigateUser,
  };
  window.__jse_hn_user__ = api;
  return { ok: true, version: VERSION, name: 'user-bridge' };
})();
