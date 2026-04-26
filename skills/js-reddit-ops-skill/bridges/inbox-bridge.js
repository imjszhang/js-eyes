// bridges/inbox-bridge.js
// ---------------------------------------------------------------------------
// Reddit 收件箱 bridge（READ-only，需登录）。
//
// 暴露 window.__jse_reddit_inbox__ API：
//   __meta = { version, name }
//   probe()
//   state()
//   sessionState()
//   inboxList({ box?, limit?, after? })
//
// box ∈ {inbox, unread, messages, mentions, sent, moderator}
// 严格只读，绝不调 mark_read / send_message / compose 等写接口。
// ---------------------------------------------------------------------------

(function install(){
  'use strict';
  const VERSION = '3.4.1';

  // @@include ./common.js

  const DEFAULT_LIMIT = 25;
  const MAX_LIMIT = 100;
  const ALLOWED_BOXES = new Set(['inbox', 'unread', 'messages', 'mentions', 'sent', 'moderator']);

  function parseBoxFromPath(){
    const m = /^\/message\/([\w-]+)\/?/.exec(location.pathname || '');
    return m && ALLOWED_BOXES.has(m[1]) ? m[1] : null;
  }

  async function probe(){
    const box = parseBoxFromPath();
    let me = { loggedIn: false };
    try { me = await readMeViaApi(false); } catch (_) {}
    return okResult({
      url: location.href,
      frontend: detectFrontend(),
      box,
      login: { api: me, dom: readLoginStateDom(), loggedIn: !!(me.loggedIn || readLoginStateDom().loggedIn) },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'inbox-bridge' },
    });
  }

  async function state(){
    const box = parseBoxFromPath();
    let me = { loggedIn: false };
    try { me = await readMeViaApi(false); } catch (_) {}
    const ready = !!(me.loggedIn);
    return okResult({
      ready,
      reason: ready ? null : 'not_logged_in',
      url: location.href,
      box,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function inboxList(args){
    args = args || {};
    const rawBox = String(args.box || parseBoxFromPath() || 'inbox').toLowerCase();
    const box = ALLOWED_BOXES.has(rawBox) ? rawBox : 'inbox';
    const limit = clampLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const after = args.after ? String(args.after) : null;

    let me = { loggedIn: false };
    try { me = await readMeViaApi(false); } catch (_) {}
    if (!me.loggedIn) return errResult('not_logged_in');

    const path = `/message/${box}.json`;
    const params = { limit };
    if (after) params.after = after;
    const t0 = Date.now();
    const resp = await fetchRedditJson(path, params, { textLimit: 2048 });
    const fetchDurationMs = Date.now() - t0;
    if (!resp.ok || !resp.data || resp.data._nonJson) {
      return errResult('fetch_failed', { httpStatus: resp.httpStatus, url: resp.url });
    }
    const summary = summarizeListing(resp.data, { normalize: normalizeMessageListingItem });
    return okResult({
      box,
      requestedLimit: limit,
      ...summary,
      meta: {
        bridge: 'inbox-bridge',
        version: VERSION,
        endpoint: resp.url,
        httpStatus: resp.httpStatus,
        fetchDurationMs,
        truncated: summary.returnedCount >= limit,
      },
    });
  }

  function navigateInbox(args){
    args = args || {};
    const rawBox = String(args.box || 'inbox').toLowerCase();
    const box = ALLOWED_BOXES.has(rawBox) ? rawBox : 'inbox';
    return navigateLocation(`https://www.reddit.com/message/${box}/`);
  }

  const api = {
    __meta: { version: VERSION, name: 'inbox-bridge' },
    probe,
    state,
    sessionState,
    inboxList,
    navigateInbox,
  };
  window.__jse_reddit_inbox__ = api;
  return { ok: true, version: VERSION, name: 'inbox-bridge' };
})();
