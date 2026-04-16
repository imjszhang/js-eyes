'use strict';

const crypto = require('crypto');

const CANARY_PREFIX = 'jse-c-';

class TaintRegistry {
  constructor(options = {}) {
    this.minValueLength = options.minValueLength || 6;
    this.mode = options.mode || 'canary+substring';
    this.values = new Map();
    this.canaries = new Map();
  }

  _generateCanary() {
    return CANARY_PREFIX + crypto.randomBytes(8).toString('hex');
  }

  register(value, meta = {}) {
    if (typeof value !== 'string' || value.length < this.minValueLength) {
      return null;
    }
    const canary = this._generateCanary();
    this.values.set(value, { canary, meta, at: Date.now() });
    this.canaries.set(canary, { value, meta, at: Date.now() });
    return canary;
  }

  mintCanary(meta = {}) {
    const canary = this._generateCanary();
    this.canaries.set(canary, { value: null, meta, at: Date.now() });
    return canary;
  }

  tagCookie(cookie, meta = {}) {
    if (!cookie || typeof cookie !== 'object') return cookie;
    const value = typeof cookie.value === 'string' ? cookie.value : '';
    const canary = this.register(value, { ...meta, cookieName: cookie.name });
    if (!canary) return cookie;
    return { ...cookie, __canary: canary };
  }

  tagCookies(cookies, meta = {}) {
    if (!Array.isArray(cookies)) return cookies;
    return cookies.map((c) => this.tagCookie(c, meta));
  }

  _variantNeedles(value) {
    const needles = new Set();
    needles.add(value);
    try { needles.add(encodeURIComponent(value)); } catch {}
    try { needles.add(Buffer.from(value, 'utf8').toString('base64')); } catch {}
    try {
      needles.add(Buffer.from(value, 'utf8').toString('hex'));
    } catch {}
    return Array.from(needles).filter((n) => typeof n === 'string' && n.length >= this.minValueLength);
  }

  scan(input) {
    const serialized = safeStringify(input);
    if (!serialized) return { hit: false };

    for (const canary of this.canaries.keys()) {
      if (serialized.includes(canary)) {
        const meta = this.canaries.get(canary)?.meta || {};
        return { hit: true, reason: 'canary', canary, meta };
      }
    }

    if (this.mode.includes('substring')) {
      for (const [value, info] of this.values.entries()) {
        for (const needle of this._variantNeedles(value)) {
          if (needle && serialized.includes(needle)) {
            return { hit: true, reason: 'value', canary: info.canary, meta: info.meta };
          }
        }
      }
    }
    return { hit: false };
  }
}

function safeStringify(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    try { return String(v); } catch { return ''; }
  }
}

module.exports = { TaintRegistry, CANARY_PREFIX };
