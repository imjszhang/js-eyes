// bridges/scholar-bridge.js
// ---------------------------------------------------------------------------
// Google Scholar bridge. window.__jse_google_scholar__
// ---------------------------------------------------------------------------

(function install() {
  'use strict';
  const VERSION = '1.0.0';

  // @@include ./common.js
  // @@include ../lib/serp/parsers.js

  function currentQuery() {
    try { return new URLSearchParams(location.search).get('q') || ''; } catch (_) { return ''; }
  }

  async function probe() {
    const page = asPage();
    const blocker = classifyPage(page);
    return okResult({
      url: location.href,
      vertical: 'scholar',
      query: currentQuery(),
      blocker,
      login: readLoginStateDom(),
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'scholar-bridge' },
    });
  }

  async function state() {
    const page = asPage();
    const blocker = classifyPage(page);
    const q = currentQuery();
    return okResult({
      ready: !!q && !blocker,
      reason: blocker ? blocker.kind : (q ? null : 'no_query'),
      query: q,
      vertical: 'scholar',
      url: location.href,
      blocker,
      bridgeVersion: VERSION,
    });
  }

  function sessionState() { return sessionStateCommon(); }

  async function extractPage(args) {
    args = args || {};
    const page = asPage();
    const blocker = classifyPage(page);
    if (blocker && (blocker.kind === 'consent_required' || blocker.kind === 'captcha_required')) {
      return errResult(blocker.kind, { reason: blocker.reason, blocker });
    }
    const parsed = parseScholarResults(page, { limit: args.limit });
    return okResult({
      vertical: 'scholar',
      query: args.query || currentQuery(),
      items: parsed.items,
      empty: parsed.empty,
      blocker: parsed.empty ? { kind: 'no_results', reason: 'empty_extract' } : (blocker || null),
      meta: { bridge: 'scholar-bridge', version: VERSION, source: 'dom' },
    });
  }

  function navigateSearch(args) {
    args = args || {};
    const query = normalizeQuery(args.query || args.q || currentQuery());
    if (!query) return errResult('missing_query');
    const url = new URL('https://scholar.google.com/scholar');
    url.searchParams.set('q', query);
    if (args.language) url.searchParams.set('hl', String(args.language));
    if (args.yearFrom != null) url.searchParams.set('as_ylo', String(args.yearFrom));
    if (args.yearTo != null) url.searchParams.set('as_yhi', String(args.yearTo));
    if (args.sortBy === 'date') url.searchParams.set('scisbd', '1');
    return navigateLocation(url.toString());
  }

  const api = {
    __meta: { version: VERSION, name: 'scholar-bridge' },
    probe,
    state,
    sessionState,
    extractPage,
    navigateSearch,
    dumpOutline,
  };
  window.__jse_google_scholar__ = api;
  return { ok: true, version: VERSION, name: 'scholar-bridge' };
})();
