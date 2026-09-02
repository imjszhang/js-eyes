'use strict';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_TITLE = 300;
const MAX_SNIPPET = 500;
const MAX_CITE = 400;

const VERTICALS = new Set(['web', 'news', 'images', 'scholar']);
const TIME_RANGES = new Set(['h', 'd', 'w', 'm', 'y']);
const SORT_BY = new Set(['relevance', 'date']);
const SAFE_SEARCH = new Set(['active', 'off']);

function clampLimit(value, defaultValue, maxValue) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(Math.floor(n), maxValue);
}

function clampText(value, maxLen) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function normalizeQuery(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function isVertical(value) {
  return VERTICALS.has(String(value || '').toLowerCase());
}

function normalizeVertical(value, fallback) {
  const v = String(value || '').toLowerCase();
  return VERTICALS.has(v) ? v : (fallback || 'web');
}

function isAllowedGoogleHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'google.com' || host === 'www.google.com' || host === 'scholar.google.com';
}

function isSearchHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'google.com' || host === 'www.google.com';
}

function isScholarHost(hostname) {
  return String(hostname || '').toLowerCase() === 'scholar.google.com';
}

function unpackGoogleHref(href, baseHref) {
  if (!href) return '';
  let absolute;
  try {
    absolute = new URL(href, baseHref || 'https://www.google.com/');
  } catch (_) {
    return '';
  }
  if (absolute.pathname === '/url') {
    const q = absolute.searchParams.get('q') || absolute.searchParams.get('url');
    if (q) {
      try { return new URL(q).toString(); } catch (_) { return q; }
    }
  }
  if ((absolute.hostname === 'www.google.com' || absolute.hostname === 'google.com')
    && absolute.pathname === '/imgres') {
    return absolute.searchParams.get('imgurl')
      || absolute.searchParams.get('imgrefurl')
      || absolute.toString();
  }
  return absolute.toString();
}

function normalizeResultUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.hash = '';
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    }
    return u.toString();
  } catch (_) {
    return String(url);
  }
}

function isGoogleChromeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'scholar.google.com') return false;
    if (host === 'encrypted-tbn0.gstatic.com' || host === 'encrypted-tbn1.gstatic.com'
      || host === 'encrypted-tbn2.gstatic.com' || host === 'encrypted-tbn3.gstatic.com') {
      return false;
    }
    if (host === 'www.google.com' || host === 'google.com') return true;
    if (host.endsWith('.google.com')) return true;
    if (host.endsWith('googleusercontent.com') && !/\.pdf($|\?)/i.test(u.pathname)) return true;
    return false;
  } catch (_) {
    return true;
  }
}

function isUsableResultUrl(url, { allowThumbnail } = {}) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    if (allowThumbnail && /encrypted-tbn\d?\.gstatic\.com$/i.test(u.hostname)) return true;
    if (isGoogleChromeUrl(url)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function detectVerticalFromUrl(url) {
  try {
    const u = new URL(url);
    if (isScholarHost(u.hostname)) return 'scholar';
    if (!isSearchHost(u.hostname)) return null;
    const tbm = (u.searchParams.get('tbm') || '').toLowerCase();
    const udm = u.searchParams.get('udm') || '';
    if (tbm === 'nws' || udm === '12') return 'news';
    if (tbm === 'isch' || udm === '2') return 'images';
    if (u.pathname === '/search' || u.pathname === '/search/') return 'web';
    return null;
  } catch (_) {
    return null;
  }
}

function detectVertical(page) {
  return detectVerticalFromUrl(page && page.locationHref) || 'web';
}

function pageSampleText(page) {
  const title = page && page.title ? String(page.title) : '';
  const body = page && page.querySelector ? page.querySelector('body') : null;
  const bodyText = body && body.textContent ? String(body.textContent) : '';
  return clampText(`${title} ${bodyText}`, 2000).toLowerCase();
}

function classifyPage(page) {
  if (!page) return { kind: 'unexpected_page', reason: 'missing_page' };
  const host = String(page.hostname || '').toLowerCase();
  const path = String(page.pathname || '');
  const href = String(page.locationHref || '');
  const title = String(page.title || '');
  const sample = pageSampleText(page);

  if (/consent\.google\.com/i.test(host) || /consent\.google\.com/i.test(href)) {
    return { kind: 'consent_required', reason: 'consent_host' };
  }
  if (page.querySelector && page.querySelector('#L2AGLb')) {
    return { kind: 'consent_required', reason: 'consent_button' };
  }
  if (/before you continue|before continuing|在继续之前|同意.*cookie|cookie.*consent/i.test(title)
    || /before you continue to google|同意 Google 使用 Cookie/i.test(sample)) {
    return { kind: 'consent_required', reason: 'consent_copy' };
  }

  if (/\/sorry\//i.test(path) || /\/sorry\//i.test(href)) {
    return { kind: 'captcha_required', reason: 'sorry_path' };
  }
  if (page.querySelector && (
    page.querySelector('#recaptcha')
    || page.querySelector('.g-recaptcha')
    || page.querySelector('iframe[src*="recaptcha"]')
  )) {
    return { kind: 'captcha_required', reason: 'recaptcha' };
  }
  if (/unusual traffic|unusual activity|异常流量|our systems have detected/i.test(title)
    || /unusual traffic from your computer|检测到异常流量/i.test(sample)) {
    return { kind: 'captcha_required', reason: 'unusual_traffic' };
  }

  const vertical = detectVerticalFromUrl(href);
  if (!vertical && !isSearchHost(host) && !isScholarHost(host)) {
    return { kind: 'unexpected_page', reason: 'not_google_search' };
  }
  return null;
}

function closestAnchor(el) {
  let cur = el;
  for (let i = 0; i < 8 && cur; i++) {
    const tag = String(cur.tagName || '').toUpperCase();
    if (tag === 'A') return cur;
    if (cur.closest) {
      const hit = cur.closest('a');
      if (hit) return hit;
    }
    cur = cur.parentElement || null;
  }
  return null;
}

function nearbyText(el, maxLen) {
  let cur = el;
  for (let i = 0; i < 5 && cur; i++) {
    const text = clampText(cur.textContent, maxLen + 80);
    if (text && text.length > 20) return clampText(text, maxLen);
    cur = cur.parentElement || null;
  }
  return '';
}

function findInAncestors(el, sel) {
  let cur = el;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.querySelector) {
      const hit = cur.querySelector(sel);
      if (hit) return hit;
    }
    cur = cur.parentElement || null;
  }
  return null;
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = normalizeResultUrl(item && (item.url || item.sourceUrl || item.thumbnailUrl));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function attachRanks(items) {
  return (items || []).map((item, i) => Object.assign({}, item, { rank: i + 1 }));
}

function parseHeadingResults(page, options, kind) {
  const limit = clampLimit(options && options.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const headings = page.querySelectorAll
    ? page.querySelectorAll('#search h3, #rso h3, #center_col h3, [role="heading"] h3, h3')
    : [];
  const items = [];
  for (let i = 0; i < headings.length && items.length < limit; i++) {
    const h3 = headings[i];
    const title = clampText(h3 && h3.textContent, MAX_TITLE);
    if (!title) continue;
    const link = closestAnchor(h3);
    const rawHref = (link && (link.href || (link.getAttribute && link.getAttribute('href')))) || '';
    const url = normalizeResultUrl(unpackGoogleHref(rawHref, page.locationHref));
    if (!isUsableResultUrl(url)) continue;
    const snippet = clampText(nearbyText(h3.parentElement || h3, MAX_SNIPPET), MAX_SNIPPET);
    const item = { title, url, snippet };
    if (kind === 'news') {
      const timeEl = findInAncestors(h3, 'time');
      const sourceEl = findInAncestors(h3, '[data-source]');
      item.source = clampText(sourceEl && sourceEl.textContent, 80) || undefined;
      item.publishedAt = (timeEl && timeEl.getAttribute && timeEl.getAttribute('datetime'))
        || clampText(timeEl && timeEl.textContent, 80)
        || undefined;
    }
    items.push(item);
  }
  return attachRanks(dedupeItems(items).slice(0, limit));
}

function parseWebResults(page, options) {
  const items = parseHeadingResults(page, options, 'web');
  return {
    vertical: 'web',
    items,
    empty: items.length === 0,
  };
}

function parseNewsResults(page, options) {
  const items = parseHeadingResults(page, options, 'news');
  return {
    vertical: 'news',
    items,
    empty: items.length === 0,
  };
}

function parseImagesResults(page, options) {
  const limit = clampLimit(options && options.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const images = page.querySelectorAll
    ? page.querySelectorAll('#search img, #islrg img, a img')
    : [];
  const items = [];
  for (let i = 0; i < images.length && items.length < limit; i++) {
    const img = images[i];
    const src = (img.getAttribute && (img.getAttribute('src') || img.getAttribute('data-src'))) || '';
    const thumbnailUrl = normalizeResultUrl(unpackGoogleHref(src, page.locationHref));
    if (!thumbnailUrl || thumbnailUrl.startsWith('data:')) continue;
    const link = closestAnchor(img);
    const rawHref = (link && (link.href || (link.getAttribute && link.getAttribute('href')))) || '';
    const unpacked = normalizeResultUrl(unpackGoogleHref(rawHref, page.locationHref));
    const sourceUrl = isUsableResultUrl(unpacked) ? unpacked : '';
    const title = clampText((img.getAttribute && img.getAttribute('alt')) || '', MAX_TITLE);
    if (!sourceUrl && !isUsableResultUrl(thumbnailUrl, { allowThumbnail: true })) continue;
    items.push({
      title: title || 'image',
      url: sourceUrl || thumbnailUrl,
      thumbnailUrl: isUsableResultUrl(thumbnailUrl, { allowThumbnail: true }) ? thumbnailUrl : undefined,
      sourceUrl: sourceUrl || undefined,
    });
  }
  const unique = attachRanks(dedupeItems(items).slice(0, limit));
  return { vertical: 'images', items: unique, empty: unique.length === 0 };
}

function parseYear(text) {
  const m = String(text || '').match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

function parseScholarResults(page, options) {
  const limit = clampLimit(options && options.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const rows = page.querySelectorAll
    ? page.querySelectorAll('.gs_r, .gs_ri')
    : [];
  const items = [];
  const seen = new Set();
  for (let i = 0; i < rows.length && items.length < limit; i++) {
    const row = rows[i];
    const titleEl = row.querySelector ? (row.querySelector('h3.gs_rt a') || row.querySelector('h3 a') || row.querySelector('a')) : null;
    const title = clampText(titleEl && titleEl.textContent, MAX_TITLE);
    const rawHref = (titleEl && (titleEl.href || (titleEl.getAttribute && titleEl.getAttribute('href')))) || '';
    const url = normalizeResultUrl(unpackGoogleHref(rawHref, page.locationHref));
    if (!title || !isUsableResultUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const citeEl = row.querySelector ? row.querySelector('.gs_a') : null;
    const snippetEl = row.querySelector ? row.querySelector('.gs_rs') : null;
    const pdfEl = row.querySelector
      ? (row.querySelector('.gs_or_ggsm a') || row.querySelector('a[href*=".pdf"]'))
      : null;
    const cite = clampText(citeEl && citeEl.textContent, MAX_CITE);
    const pdfHref = pdfEl && (pdfEl.href || (pdfEl.getAttribute && pdfEl.getAttribute('href')));
    const pdfUrl = pdfHref ? normalizeResultUrl(unpackGoogleHref(pdfHref, page.locationHref)) : '';
    items.push({
      title,
      url,
      snippet: clampText(snippetEl && snippetEl.textContent, MAX_SNIPPET),
      cite: cite || undefined,
      pdfUrl: pdfUrl || undefined,
      year: parseYear(cite) || undefined,
    });
  }
  return {
    vertical: 'scholar',
    items: attachRanks(items.slice(0, limit)),
    empty: items.length === 0,
  };
}

function parseResults(page, options) {
  const vertical = normalizeVertical(options && options.vertical, detectVertical(page));
  if (vertical === 'news') return parseNewsResults(page, options);
  if (vertical === 'images') return parseImagesResults(page, options);
  if (vertical === 'scholar') return parseScholarResults(page, options);
  return parseWebResults(page, options);
}

const parsers = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  VERTICALS,
  TIME_RANGES,
  SORT_BY,
  SAFE_SEARCH,
  clampLimit,
  clampText,
  normalizeQuery,
  isVertical,
  normalizeVertical,
  isAllowedGoogleHost,
  isSearchHost,
  isScholarHost,
  unpackGoogleHref,
  normalizeResultUrl,
  isGoogleChromeUrl,
  isUsableResultUrl,
  detectVerticalFromUrl,
  detectVertical,
  classifyPage,
  dedupeItems,
  parseWebResults,
  parseNewsResults,
  parseImagesResults,
  parseScholarResults,
  parseResults,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = parsers;
}
