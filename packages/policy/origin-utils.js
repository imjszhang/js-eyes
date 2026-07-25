'use strict';

const { URL } = require('url');

function toLower(v) {
  return typeof v === 'string' ? v.toLowerCase().trim() : '';
}

function extractOriginsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const out = new Set();
  const urlRegex = /\bhttps?:\/\/[^\s'"<>`]+/gi;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const origin = parseOriginFromUrl(match[0]);
    if (origin) out.add(origin);
  }
  const domainRegex = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi;
  while ((match = domainRegex.exec(text)) !== null) {
    const host = match[1].toLowerCase();
    if (host.includes('.') && !host.startsWith('.') && !host.endsWith('.')) {
      if (/[a-z]/.test(host.split('.').pop())) {
        out.add(host);
      }
    }
  }
  return Array.from(out);
}

function parseOriginFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeHost(host) {
  const h = toLower(host);
  if (!h) return '';
  return h.replace(/^\.+/, '').replace(/:\d+$/, '');
}

function hostMatches(host, pattern) {
  const h = normalizeHost(host);
  const p = toLower(pattern);
  if (!h || !p) return false;
  if (p === '*') return true;
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return h === base || h.endsWith('.' + base);
  }
  if (p.startsWith('.')) {
    const base = p.slice(1);
    return h === base || h.endsWith('.' + base);
  }
  if (h === p) return true;
  if (h.endsWith('.' + p)) return true;
  return false;
}

function extractLinksFromHtml(html, limit = 200) {
  if (!html || typeof html !== 'string') return [];
  const out = new Set();
  const regex = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match;
  let count = 0;
  while ((match = regex.exec(html)) !== null && count < limit) {
    const href = match[1] || match[2] || match[3];
    if (!href) continue;
    if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    const origin = parseOriginFromUrl(href);
    if (origin) {
      out.add(origin);
      count++;
    }
  }
  return Array.from(out);
}

module.exports = {
  extractOriginsFromText,
  extractLinksFromHtml,
  parseOriginFromUrl,
  normalizeHost,
  hostMatches,
};
