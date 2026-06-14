// bridges/item-bridge.js
(function install(){
  'use strict';
  const VERSION = '1.0.0';

  // @@include ./common.js

  async function probe(){
    const itemId = parseItemIdFromUrl(location.href);
    const login = readLoginState();
    return okResult({
      url: location.href,
      itemId,
      login: { loggedIn: !!login.loggedIn, name: login.name, source: login.source },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'item-bridge' },
    });
  }

  async function state(){
    const itemId = parseItemIdFromUrl(location.href);
    return okResult({
      ready: itemId != null,
      reason: itemId != null ? null : 'not_on_item_page',
      url: location.href,
      itemId,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function api_getItem(args){
    args = args || {};
    let itemId = args.itemId != null ? Number(args.itemId) : null;
    if (!Number.isFinite(itemId)) itemId = parseItemIdFromUrl(args.url || location.href);
    if (!Number.isFinite(itemId)) return errResult('missing_item_id');
    const depth = clampLimit(args.depth, 6, 20);
    const commentLimit = clampLimit(args.commentLimit || args.limit, 200, 500);
    const t0 = Date.now();
    const root = await fetchSingleItem(itemId);
    if (!root.ok || !root.item) {
      return errResult('fetch_item_failed', {
        httpStatus: root.resp && root.resp.httpStatus,
        url: root.resp && root.resp.url,
      });
    }
    const post = summarizeApiItem(root.item);
    const tree = await fetchItemTree(itemId, { depth, limit: commentLimit });
    const comments = tree.items.filter((it) => it.id !== itemId);
    return okResult({
      itemId,
      post,
      comments,
      byParent: tree.byParent,
      truncated: tree.truncated,
      meta: {
        bridge: 'item-bridge',
        version: VERSION,
        readMode: 'api',
        depth,
        commentLimit,
        fetchDurationMs: Date.now() - t0,
        commentCount: comments.length,
      },
    });
  }

  async function dom_getItem(args){
    args = args || {};
    const itemId = args.itemId != null ? Number(args.itemId) : parseItemIdFromUrl(args.url || location.href);
    const parsed = parseItemPageDom();
    if (itemId != null) parsed.post.itemId = itemId;
    return okResult({
      itemId: parsed.post.itemId || itemId,
      post: parsed.post,
      comments: parsed.comments,
      byParent: parsed.byParent,
      truncated: false,
      meta: {
        bridge: 'item-bridge',
        version: VERSION,
        readMode: 'dom',
        commentCount: parsed.comments.length,
      },
    });
  }

  async function getItem(args){
    args = args || {};
    const mode = resolveReadMode(args.readMode);
    if (mode === 'dom') return dom_getItem(args);
    const apiRes = await api_getItem(args);
    if (mode === 'api') return apiRes;
    if (apiRes.ok) return apiRes;
    const domRes = await dom_getItem(args);
    if (domRes.ok) {
      domRes.data.meta = Object.assign({}, domRes.data.meta, { bridgeFallbackReason: apiRes.error || 'api_failed' });
    }
    return domRes;
  }

  function navigateItem(args){
    args = args || {};
    let itemId = args.itemId != null ? Number(args.itemId) : null;
    if (!Number.isFinite(itemId)) itemId = parseItemIdFromUrl(args.url || '');
    if (!Number.isFinite(itemId)) itemId = parseItemIdFromUrl(location.href);
    if (!Number.isFinite(itemId)) return errResult('missing_item_id');
    const url = 'https://news.ycombinator.com/item?id=' + encodeURIComponent(String(Math.floor(itemId)));
    return navigateLocation(url);
  }

  const api = {
    __meta: { version: VERSION, name: 'item-bridge' },
    probe,
    state,
    sessionState,
    getItem,
    api_getItem,
    dom_getItem,
    navigateItem,
  };
  window.__jse_hn_item__ = api;
  return { ok: true, version: VERSION, name: 'item-bridge' };
})();
