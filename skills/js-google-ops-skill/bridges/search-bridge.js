// bridges/search-bridge.js
// ---------------------------------------------------------------------------
// Google Web / News / Images bridge. Scholar uses scholar-bridge.js.
//
// window.__jse_google_search__ :
//   __meta / probe / state / sessionState / extractPage / navigateSearch / dumpOutline
// ---------------------------------------------------------------------------

(function install() {
  'use strict';
  const VERSION = '1.0.0';

  // @@include ./common.js
  // @@include ../lib/serp/parsers.js

  function currentQuery() {
    try { return new URLSearchParams(location.search).get('q') || ''; } catch (_) { return ''; }
  }

  function currentVertical() {
    return detectVerticalFromUrl(location.href) || 'web';
  }

  async function probe() {
    const page = asPage();
    const blocker = classifyPage(page);
    const login = readLoginStateDom();
    return okResult({
      url: location.href,
      vertical: currentVertical(),
      query: currentQuery(),
      blocker,
      login,
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'search-bridge' },
    });
  }

  async function state() {
    const page = asPage();
    const blocker = classifyPage(page);
    const q = currentQuery();
    const ready = !!q && !blocker;
    return okResult({
      ready,
      reason: blocker ? blocker.kind : (q ? null : 'no_query'),
      query: q,
      vertical: currentVertical(),
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
    if (blocker && blocker.kind === 'unexpected_page') {
      return errResult('unexpected_page', { reason: blocker.reason, blocker });
    }
    const vertical = normalizeVertical(args.vertical, currentVertical());
    if (vertical === 'images') {
      const rounds = clampLimit(args.scrollRounds, 1, 3);
      for (let i = 1; i < rounds; i++) {
        try { window.scrollTo(0, document.body.scrollHeight); } catch (_) {}
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    const parsed = parseResults(asPage(), {
      vertical,
      query: args.query,
      limit: args.limit,
    });
    if (parsed.empty && !blocker) {
      return okResult({
        vertical,
        query: args.query || currentQuery(),
        items: [],
        empty: true,
        blocker: { kind: 'no_results', reason: 'empty_extract' },
      });
    }
    return okResult({
      vertical,
      query: args.query || currentQuery(),
      items: parsed.items,
      empty: parsed.empty,
      blocker: blocker || null,
      meta: { bridge: 'search-bridge', version: VERSION, source: 'dom' },
    });
  }

  function navigateSearch(args) {
    args = args || {};
    const query = normalizeQuery(args.query || args.q || currentQuery());
    if (!query) return errResult('missing_query');
    const vertical = normalizeVertical(args.vertical, 'web');
    const usp = new URLSearchParams();
    usp.set('q', query);
    if (vertical === 'web') usp.set('udm', '14');
    if (vertical === 'news') {
      usp.set('tbm', 'nws');
      if (args.timeRange) usp.set('tbs', 'qdr:' + String(args.timeRange));
    }
    if (vertical === 'images') usp.set('tbm', 'isch');
    if (args.language) usp.set('hl', String(args.language));
    if (args.region) usp.set('gl', String(args.region));
    if (args.safeSearch) usp.set('safe', String(args.safeSearch));
    if (vertical === 'scholar') {
      const scholar = new URL('https://scholar.google.com/scholar');
      scholar.search = usp.toString();
      if (args.yearFrom != null) scholar.searchParams.set('as_ylo', String(args.yearFrom));
      if (args.yearTo != null) scholar.searchParams.set('as_yhi', String(args.yearTo));
      if (args.sortBy === 'date') scholar.searchParams.set('scisbd', '1');
      return navigateLocation(scholar.toString());
    }
    return navigateLocation('https://www.google.com/search?' + usp.toString());
  }

  const api = {
    __meta: { version: VERSION, name: 'search-bridge' },
    probe,
    state,
    sessionState,
    extractPage,
    navigateSearch,
    dumpOutline,
  };
  window.__jse_google_search__ = api;
  return { ok: true, version: VERSION, name: 'search-bridge' };
})();
