// bridges/common.js
// Browser-only helpers. Inlined by the @@include directive in each bridge.

function clampLimit(value, defaultValue, maxValue) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(Math.floor(n), maxValue);
}

function okResult(data) { return { ok: true, data }; }
function errResult(error, extra) { return Object.assign({ ok: false, error: String(error) }, extra || {}); }

function wrapEl(el) {
  if (!el) return null;
  const wrapped = {
    tagName: el.tagName,
    textContent: el.textContent || '',
    href: el.href || '',
    getAttribute(name) { return el.getAttribute(name); },
    querySelector(sel) {
      try { return wrapEl(el.querySelector(sel)); } catch (_) { return null; }
    },
    querySelectorAll(sel) {
      try { return Array.from(el.querySelectorAll(sel)).map(wrapEl); } catch (_) { return []; }
    },
    closest(sel) {
      try { return wrapEl(el.closest(sel)); } catch (_) { return null; }
    },
  };
  Object.defineProperty(wrapped, 'parentElement', {
    get() { return wrapEl(el.parentElement); },
  });
  return wrapped;
}

function asPage() {
  return {
    locationHref: location.href,
    hostname: location.hostname,
    pathname: location.pathname,
    title: document.title || '',
    querySelector(sel) {
      try { return wrapEl(document.querySelector(sel)); } catch (_) { return null; }
    },
    querySelectorAll(sel) {
      try { return Array.from(document.querySelectorAll(sel)).map(wrapEl); } catch (_) { return []; }
    },
  };
}

function readLoginStateDom() {
  try {
    const account = document.querySelector('a[href*="SignOutOptions"], a[aria-label*="Google Account"], img[src*="googleusercontent.com/a/"]');
    if (account) return { loggedIn: true, accountHint: 'present', source: 'account-affordance' };
    const signIn = document.querySelector('a[href*="ServiceLogin"], a[href*="accounts.google.com/ServiceLogin"]');
    if (signIn) return { loggedIn: false, accountHint: null, source: 'signin-link' };
  } catch (_) {}
  return { loggedIn: null, accountHint: null, source: 'unknown' };
}

async function sessionStateCommon() {
  const dom = readLoginStateDom();
  return okResult({
    loggedIn: dom.loggedIn,
    accountHint: dom.accountHint,
    source: dom.source,
    host: location.hostname,
    path: location.pathname,
    url: location.href,
    timestamp: new Date().toISOString(),
  });
}

function navigateLocation(targetUrl) {
  const fromUrl = location.href;
  if (typeof targetUrl !== 'string' || !targetUrl) {
    return errResult('missing_target_url');
  }
  let parsed;
  try { parsed = new URL(targetUrl, location.href); } catch (_) {
    return errResult('invalid_target_url', { targetUrl });
  }
  if (!isAllowedGoogleHost(parsed.hostname)) {
    return errResult('cross_origin_navigation_forbidden', { hostname: parsed.hostname });
  }
  const to = parsed.toString();
  if (to === fromUrl) {
    return okResult({ noop: true, from: { url: fromUrl }, to: { url: to }, hint: 'already_at_target' });
  }
  try {
    location.assign(to);
  } catch (e) {
    return errResult('location_assign_threw', {
      message: String((e && e.message) || e),
      from: { url: fromUrl },
      to: { url: to },
    });
  }
  return okResult({ noop: false, from: { url: fromUrl }, to: { url: to }, hint: 'page_will_reload' });
}

function dumpOutline(args) {
  args = args || {};
  const limit = clampLimit(args.limit, 80, 200);
  const selectors = [
    '#search', '#rso', '#center_col', '#topstuff', '#recaptcha', '#L2AGLb',
    'h3', '.gs_r', '.gs_ri', 'img', 'time', 'form',
  ];
  if (args.anchors) selectors.push('a[href]');
  const out = [];
  const seen = new WeakSet();
  for (let s = 0; s < selectors.length && out.length < limit; s++) {
    let nodes = [];
    try { nodes = Array.from(document.querySelectorAll(selectors[s])); } catch (_) { nodes = []; }
    for (let i = 0; i < nodes.length && out.length < limit; i++) {
      const n = nodes[i];
      if (seen.has(n)) continue;
      seen.add(n);
      out.push({
        selector: selectors[s],
        tag: (n.tagName || '').toLowerCase(),
        id: n.id || '',
        href: ((n.getAttribute && n.getAttribute('href')) || '').slice(0, 180),
        text: ((n.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 160),
      });
    }
  }
  return okResult({
    url: location.href,
    title: (document.title || '').slice(0, 180),
    returnedCount: out.length,
    items: out,
  });
}
