'use strict';

/**
 * xhsUtils - 小红书 URL 与字段规整 helpers（纯 Node 端，不进 bridge）。
 */

function isXiaohongshuUrl(input) {
  const s = String(input || '');
  return /xiaohongshu\.com\b/i.test(s) || /\bxhslink\.com\b/i.test(s);
}

function isXhsShortUrl(input) {
  return /\bxhslink\.com\b/i.test(String(input || ''));
}

/**
 * 规整笔记 URL：
 *   - search_result 中点开的笔记会带 `/search_result/<id>?...` 形式，规整成 `/explore/<id>?...`；
 *   - 兼容 /discovery/item/<id> → /explore/<id>。
 *   - 保留 query（含 xsec_token / xsec_source）。
 */
function processXiaohongshuUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (/xiaohongshu\.com$/i.test(u.hostname) || /xiaohongshu\.com$/i.test(u.host)) {
      const m1 = u.pathname.match(/^\/search_result\/([\w-]+)\/?$/i);
      if (m1) {
        u.pathname = `/explore/${m1[1]}`;
      }
      const m2 = u.pathname.match(/^\/discovery\/item\/([\w-]+)\/?$/i);
      if (m2) {
        u.pathname = `/explore/${m2[1]}`;
      }
    }
    return u.toString();
  } catch (_) {
    return raw;
  }
}

function extractNoteIdFromUrl(input) {
  const raw = String(input || '');
  const m = raw.match(/\/(?:explore|discovery\/item|search_result)\/([\w-]+)/i);
  if (m) return m[1];
  return null;
}

function extractUserIdFromUrl(input) {
  const raw = String(input || '');
  const m = raw.match(/\/user\/profile\/([\w-]+)/i);
  if (m) return m[1];
  return null;
}

function buildNoteUrl(noteId, params = {}) {
  if (!noteId) return null;
  const u = new URL(`https://www.xiaohongshu.com/explore/${encodeURIComponent(noteId)}`);
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

function buildSearchUrl({ keyword, channelType, sortBy, contentType, timeRange, searchScope } = {}) {
  const q = String(keyword || '').trim();
  const u = new URL('https://www.xiaohongshu.com/search_result');
  if (q) u.searchParams.set('keyword', q);
  u.searchParams.set('source', 'web_explore_feed');
  return u.toString();
}

function buildUserUrl(userId) {
  const id = String(userId || '').trim();
  if (!id) return 'https://www.xiaohongshu.com/';
  return `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(id)}`;
}

function buildHomeUrl() {
  return 'https://www.xiaohongshu.com/explore';
}

/**
 * 归一化 a1 / web_session 之类敏感字段（用于 sanitize history / debug）。
 */
const SENSITIVE_COOKIE_NAMES = ['a1', 'web_session', 'webId', 'gid', 'gid.sign', 'websectiga', 'sec_poison_id', 'unread', 'acw_tc'];

function sanitizeForRecording(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    let out = value;
    for (const name of SENSITIVE_COOKIE_NAMES) {
      const re = new RegExp(`(${name}=)[^;\\s]+`, 'gi');
      out = out.replace(re, `$1<redacted>`);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(sanitizeForRecording);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_COOKIE_NAMES.includes(k)) {
        out[k] = '<redacted>';
      } else {
        out[k] = sanitizeForRecording(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * 解析像 "1.2万" / "13.5w" / "全文" 这类计数文案。
 */
function parseCountText(value) {
  if (value == null) return null;
  const s = String(value).trim().replace(/\s+/g, '');
  if (!s) return null;
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/^([0-9]+(?:\.[0-9]+)?)([万w亿k千])/i);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === '万' || unit === 'w') return Math.round(n * 10000);
    if (unit === '亿') return Math.round(n * 1e8);
    if (unit === 'k') return Math.round(n * 1000);
    if (unit === '千') return Math.round(n * 1000);
  }
  const m2 = s.match(/^([0-9]+(?:\.[0-9]+)?)$/);
  if (m2) return parseFloat(m2[1]);
  return null;
}

function normalizeXhsUrl(inputUrl) {
  const url = new URL(inputUrl);
  url.hash = '';
  for (const key of Array.from(url.searchParams.keys())) {
    if (key.startsWith('utm_') || key === 'share_from_user_hidden') {
      url.searchParams.delete(key);
    }
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

module.exports = {
  isXiaohongshuUrl,
  isXhsShortUrl,
  processXiaohongshuUrl,
  extractNoteIdFromUrl,
  extractUserIdFromUrl,
  buildNoteUrl,
  buildSearchUrl,
  buildUserUrl,
  buildHomeUrl,
  parseCountText,
  sanitizeForRecording,
  normalizeXhsUrl,
  SENSITIVE_COOKIE_NAMES,
};
