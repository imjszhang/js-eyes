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
  const VERSION = '3.7.0';

  // @@include ./common.js
  // @@include ./_dom-actions.js

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

  // ---- v3.7.0 dom-first ----------------------------------------------------

  function _targetInboxUrl(box){
    const b = ALLOWED_BOXES.has(box) ? box : 'inbox';
    return `https://www.reddit.com/message/${b}/`;
  }

  function _extractInboxItemDom(node){
    if (!node) return null;
    const text = function(sel){
      try {
        const el = node.querySelector(sel);
        return el && el.textContent ? String(el.textContent).replace(/\s+/g, ' ').trim() : '';
      } catch (_) { return ''; }
    };
    const linkEl = (function(){ try { return node.querySelector('a[href]'); } catch (_) { return null; } })();
    const href = linkEl ? (linkEl.getAttribute('href') || '') : '';
    const subject = text('[id*="subject"], [class*="title"], h3, h2, strong');
    const body = text('[id*="body"], [class*="body"], p');
    const id = node.getAttribute && (node.getAttribute('thingid') || node.getAttribute('id')) || '';
    return {
      id: id || null,
      kind: 't4',
      subject: subject || (body ? body.slice(0, 80) : ''),
      body: body.slice(0, 400),
      href,
      _domSource: node.tagName ? String(node.tagName).toLowerCase() : 'unknown',
    };
  }

  async function dom_inboxList(args){
    args = args || {};
    const rawBox = String(args.box || parseBoxFromPath() || 'inbox').toLowerCase();
    const box = ALLOWED_BOXES.has(rawBox) ? rawBox : 'inbox';
    const limit = clampLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const targetUrl = _targetInboxUrl(box);

    const curBox = parseBoxFromPath();
    if (curBox !== box) {
      __jseDomEmitNavigateIntent(targetUrl);
      return errResult('dom_navigation_required', {
        to: targetUrl,
        navMethod: 'navigateInbox',
        navArgs: { box },
        retry: true,
      });
    }

    // DOM-first 登录检测：firefox 扩展 isolated world 里 fetch /api/v1/me.json
    // 经常被 reddit 当 anonymous 处理（cookie partitioning），单靠 readMeViaApi
    // 在已登录用户上仍会报 not_logged_in。先看 DOM 信号（shreddit 渲出的
    // [username] / user-drawer 等），fallback 才走 API。
    const domLogin = readLoginStateDom();
    let me = { loggedIn: false };
    if (!domLogin.loggedIn) {
      try { me = await readMeViaApi(false); } catch (_) {}
      if (!me.loggedIn) return errResult('not_logged_in');
    } else {
      me = { loggedIn: true, name: domLogin.name || null };
    }

    // reddit 偶发对自动化的 inbox 页插 reputation captcha —— 给 1.5s 让页面初始化，
    // 提前探测，命中即 dom_unstable，runTool fallback 到 api（api 自身也会被
    // cookie partition 影响，但至少不再白等 9s wait timeout）
    await new Promise(function(r){ setTimeout(r, 1500); });
    try {
      const cap = document.querySelector('shreddit-async-loader[bundlename="reputation_recaptcha"], reputation-recaptcha');
      if (cap) {
        return errResult('dom_unstable', { stage: 'captcha_blocked', detail: 'reputation_recaptcha' });
      }
    } catch (_) {}

    const t0 = Date.now();
    // inbox 各家前端结构差异较大，用宽松 selector + fallback
    const waitRes = await __jseDomWaitFor(
      ['shreddit-async-loader[bundlename="inbox_message"]', 'a[href^="/message/"]', '[data-testid="inbox-list-item"]', 'div[id^="inbox-message-"]'],
      { count: 1, timeoutMs: 9000 }
    );
    if (!waitRes.ok) {
      return errResult('dom_timeout', { stage: 'wait_inbox', detail: waitRes });
    }
    const ext = __jseDomExtract(
      [waitRes.selector, 'shreddit-async-loader[bundlename="inbox_message"]', 'a[href^="/message/"]'],
      _extractInboxItemDom,
      { limit }
    );
    if (!ext.ok) {
      return errResult('dom_extract_failed', { stage: 'extract_inbox', detail: ext });
    }
    const items = ext.items.slice(0, limit);
    const fetchDurationMs = Date.now() - t0;
    return okResult({
      box,
      requestedLimit: limit,
      returnedCount: items.length,
      items,
      meta: {
        bridge: 'inbox-bridge',
        version: VERSION,
        endpoint: location.href,
        fetchDurationMs,
        domSelector: ext.selector,
        truncated: items.length >= limit,
        source: 'dom',
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
    dom_inboxList,
  };
  for (const k of Object.keys(api)) {
    if (k === '__meta' || k.indexOf('api_') === 0 || k.indexOf('dom_') === 0) continue;
    if (typeof api[k] === 'function') api['api_' + k] = api[k];
  }
  window.__jse_reddit_inbox__ = api;
  return { ok: true, version: VERSION, name: 'inbox-bridge' };
})();
