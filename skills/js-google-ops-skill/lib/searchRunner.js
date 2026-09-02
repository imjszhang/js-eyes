'use strict';

const { searchUrl, pageStart, clampPages, DEFAULT_LIMIT, MAX_LIMIT, DEFAULT_MAX_PAGES } = require('./toolTargets');
const { clampLimit, normalizeQuery, normalizeVertical, dedupeItems, classifyPage } = require('./serp/parsers');

const DEFAULT_THROTTLE_MS = 750;
const HARD_MAX_PAGES = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blockerFromExtract(resp) {
  if (!resp) return { kind: 'dom_unstable', reason: 'empty_extract' };
  if (resp.data && resp.data.blocker && resp.data.blocker.kind) return resp.data.blocker;
  const code = resp.error;
  if (!code) return null;
  if (code === 'consent_required' || code === 'captcha_required' || code === 'unexpected_page'
    || code === 'no_results' || code === 'dom_timeout' || code === 'dom_unstable') {
    return { kind: code, reason: (resp.reason || resp.message || code) };
  }
  if (code === 'bridge_not_installed' || code === 'method_not_found' || code === 'bridge_returned_non_object') {
    return { kind: 'dom_unstable', reason: code };
  }
  return { kind: 'dom_unstable', reason: code };
}

function isHardStop(blocker) {
  return blocker && (blocker.kind === 'consent_required' || blocker.kind === 'captcha_required');
}

async function runSearch(session, args, options = {}) {
  const query = normalizeQuery(args && (args.query || args.q));
  if (!query) {
    const err = new Error('缺少 query');
    err.code = 'E_BAD_ARG';
    throw err;
  }
  const vertical = normalizeVertical(args && args.vertical, 'web');
  const limit = clampLimit(args && args.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const maxPages = Math.min(HARD_MAX_PAGES, clampPages(args && args.maxPages || DEFAULT_MAX_PAGES));
  const throttleMs = Number.isFinite(options.throttleMs) ? options.throttleMs : DEFAULT_THROTTLE_MS;

  const items = [];
  let blocker = null;
  let pagesFetched = 0;
  let endedReason = null;
  let lastExtract = null;

  for (let pageIndex = 0; pageIndex < maxPages && items.length < limit; pageIndex++) {
    const url = searchUrl(Object.assign({}, args, {
      query,
      vertical,
      pageIndex,
      start: pageStart(vertical, pageIndex),
    }));
    if (pageIndex === 0 && session.target && !session.target.url) {
      session.target.url = url;
    }
    if (pageIndex > 0 || (session.target && session.target.url !== url)) {
      await session.openTargetUrl(url);
    }
    await session.ensureBridge();
    const remaining = limit - items.length;
    const extract = await session.callApi('extractPage', [{
      query,
      vertical,
      limit: remaining,
      scrollRounds: vertical === 'images' ? Math.min(3, maxPages) : 1,
    }], { timeoutMs: options.timeoutMs || 90000 });
    lastExtract = extract;
    pagesFetched += 1;

    const pageBlocker = blockerFromExtract(extract);
    const pageItems = (extract && extract.ok && extract.data && Array.isArray(extract.data.items))
      ? extract.data.items
      : [];

    if (pageItems.length) {
      const merged = dedupeItems(items.concat(pageItems)).slice(0, limit);
      items.length = 0;
      items.push(...merged);
    }

    if (pageBlocker) {
      blocker = pageBlocker;
      if (isHardStop(pageBlocker) || !pageItems.length) {
        endedReason = 'blocker';
        break;
      }
      endedReason = 'blocker';
      break;
    }

    if (!pageItems.length) {
      endedReason = items.length ? 'no_more_results' : 'no_results';
      if (!items.length) blocker = { kind: 'no_results', reason: 'empty_page' };
      break;
    }

    if (items.length >= limit) {
      endedReason = 'limit';
      break;
    }
    if (pageIndex + 1 < maxPages) {
      await sleep(throttleMs);
    }
  }

  if (!endedReason) endedReason = pagesFetched >= maxPages ? 'max_pages' : 'complete';

  items.forEach((item, i) => { item.rank = i + 1; });

  const ok = items.length > 0 || !blocker;
  const emptyBlocker = !items.length && (!blocker || blocker.kind === 'no_results')
    ? (blocker || { kind: 'no_results', reason: 'empty' })
    : blocker;

  return {
    ok: items.length > 0 || !emptyBlocker || emptyBlocker.kind === 'no_results',
    query,
    vertical,
    items,
    pageInfo: {
      requestedLimit: limit,
      requestedMaxPages: maxPages,
      pagesFetched,
      returnedCount: items.length,
      endedReason,
    },
    blocker: items.length && emptyBlocker && emptyBlocker.kind !== 'no_results'
      ? emptyBlocker
      : (items.length ? (endedReason === 'blocker' ? blocker : null) : emptyBlocker),
    extract: lastExtract && lastExtract.data ? { empty: lastExtract.data.empty || false } : null,
    _rawOk: ok,
  };
}

function classifyLocation(locationHref, title) {
  return classifyPage({
    locationHref,
    hostname: (() => { try { return new URL(locationHref).hostname; } catch (_) { return ''; } })(),
    pathname: (() => { try { return new URL(locationHref).pathname; } catch (_) { return ''; } })(),
    title: title || '',
    querySelector() { return null; },
    querySelectorAll() { return []; },
  });
}

module.exports = {
  runSearch,
  blockerFromExtract,
  isHardStop,
  classifyLocation,
  DEFAULT_THROTTLE_MS,
  HARD_MAX_PAGES,
};
