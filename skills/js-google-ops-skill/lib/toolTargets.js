'use strict';

const {
  TIME_RANGES,
  SORT_BY,
  SAFE_SEARCH,
  clampLimit,
  normalizeQuery,
  normalizeVertical,
  isAllowedGoogleHost,
} = require('./serp/parsers');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_MAX_PAGES = 1;
const MAX_PAGES = 5;
const PAGE_SIZE = 10;
const IMAGE_PAGE_SIZE = 20;

function badArg(message) {
  const err = new Error(message);
  err.code = 'E_BAD_ARG';
  throw err;
}

function clampPages(value) {
  return clampLimit(value, DEFAULT_MAX_PAGES, MAX_PAGES);
}

function pageSizeFor(vertical) {
  return vertical === 'images' ? IMAGE_PAGE_SIZE : PAGE_SIZE;
}

function pageStart(vertical, pageIndex) {
  const idx = Number(pageIndex);
  const safe = Number.isFinite(idx) && idx > 0 ? Math.floor(idx) : 0;
  return safe * pageSizeFor(vertical);
}

function assertAllowedUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch (_) {
    badArg(`非法 URL: ${url}`);
  }
  if (!isAllowedGoogleHost(parsed.hostname)) {
    badArg(`拒绝非 Google Search host: ${parsed.hostname}`);
  }
  return parsed;
}

function searchUrl(args) {
  args = args || {};
  const query = normalizeQuery(args.query || args.q);
  if (!query) badArg('缺少 query');
  const vertical = normalizeVertical(args.vertical, 'web');
  const start = args.start != null
    ? Math.max(0, Math.floor(Number(args.start) || 0))
    : pageStart(vertical, args.pageIndex || 0);

  if (vertical === 'scholar') {
    const url = new URL('https://scholar.google.com/scholar');
    url.searchParams.set('q', query);
    if (args.language) url.searchParams.set('hl', String(args.language));
    if (args.yearFrom != null && String(args.yearFrom).trim() !== '') {
      url.searchParams.set('as_ylo', String(Math.floor(Number(args.yearFrom))));
    }
    if (args.yearTo != null && String(args.yearTo).trim() !== '') {
      url.searchParams.set('as_yhi', String(Math.floor(Number(args.yearTo))));
    }
    if (args.sortBy && SORT_BY.has(String(args.sortBy))) {
      if (args.sortBy === 'date') url.searchParams.set('scisbd', '1');
    }
    if (start > 0) url.searchParams.set('start', String(start));
    return url.toString();
  }

  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', query);
  if (vertical === 'web') url.searchParams.set('udm', '14');
  if (vertical === 'news') url.searchParams.set('tbm', 'nws');
  if (vertical === 'images') url.searchParams.set('tbm', 'isch');
  if (args.language) url.searchParams.set('hl', String(args.language));
  if (args.region) url.searchParams.set('gl', String(args.region));
  if (args.safeSearch && SAFE_SEARCH.has(String(args.safeSearch))) {
    url.searchParams.set('safe', String(args.safeSearch));
  }
  if (vertical === 'news' && args.timeRange && TIME_RANGES.has(String(args.timeRange))) {
    url.searchParams.set('tbs', `qdr:${args.timeRange}`);
  }
  if (start > 0) url.searchParams.set('start', String(start));
  assertAllowedUrl(url.toString());
  return url.toString();
}

function homeUrl(vertical) {
  const v = normalizeVertical(vertical, 'web');
  return v === 'scholar' ? 'https://scholar.google.com/' : 'https://www.google.com/';
}

function searchArgsFromCli(opts, positional, vertical) {
  const query = normalizeQuery(positional.join(' ') || opts.query || opts.q || '');
  return {
    query,
    vertical: vertical || opts.vertical || 'web',
    limit: opts.limit != null ? clampLimit(opts.limit, DEFAULT_LIMIT, MAX_LIMIT) : undefined,
    maxPages: opts.maxPages != null ? clampPages(opts.maxPages) : undefined,
    language: opts.language || opts.hl || undefined,
    region: opts.region || opts.gl || undefined,
    safeSearch: opts.safeSearch || undefined,
    timeRange: opts.timeRange || undefined,
    yearFrom: opts.yearFrom != null ? opts.yearFrom : undefined,
    yearTo: opts.yearTo != null ? opts.yearTo : undefined,
    sortBy: opts.sortBy || undefined,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_MAX_PAGES,
  MAX_PAGES,
  PAGE_SIZE,
  IMAGE_PAGE_SIZE,
  searchUrl,
  homeUrl,
  pageStart,
  pageSizeFor,
  clampPages,
  assertAllowedUrl,
  searchArgsFromCli,
};
