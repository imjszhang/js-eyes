'use strict';

const {
  extractOriginsFromText,
  extractLinksFromHtml,
  parseOriginFromUrl,
  hostMatches,
  normalizeHost,
} = require('./origin-utils');

class TaskOriginTracker {
  constructor(options = {}) {
    this.scope = new Set();
    this.sources = new Set(options.sources || ['user-message', 'skill-platforms', 'active-tab', 'fetched-links']);
    this.wildcard = false;
  }

  _has(source) {
    return this.sources.has(source);
  }

  addUserMessages(messages) {
    if (!this._has('user-message')) return;
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
      const text = typeof msg === 'string' ? msg : (msg && msg.content) ? String(msg.content) : '';
      for (const origin of extractOriginsFromText(text)) {
        this.scope.add(origin);
      }
    }
  }

  addPlatforms(platforms) {
    if (!this._has('skill-platforms')) return;
    if (!Array.isArray(platforms)) return;
    for (const p of platforms) {
      if (!p) continue;
      if (p === '*') {
        this.wildcard = true;
        continue;
      }
      const host = normalizeHost(p);
      if (host) this.scope.add(host);
    }
  }

  addActiveTabUrl(url) {
    if (!this._has('active-tab')) return;
    const origin = parseOriginFromUrl(url);
    if (origin) this.scope.add(origin);
  }

  addFetchedLinks(html) {
    if (!this._has('fetched-links')) return;
    for (const origin of extractLinksFromHtml(html)) {
      this.scope.add(origin);
    }
  }

  addExplicit(origin) {
    const host = normalizeHost(origin);
    if (host) this.scope.add(host);
  }

  isInScope(host) {
    if (this.wildcard) return true;
    if (this.scope.size === 0) return false;
    const h = normalizeHost(host);
    if (!h) return false;
    if (this.scope.has(h)) return true;
    for (const pattern of this.scope) {
      if (hostMatches(h, pattern)) return true;
    }
    return false;
  }

  snapshot() {
    return {
      wildcard: this.wildcard,
      scope: Array.from(this.scope),
      sources: Array.from(this.sources),
    };
  }
}

module.exports = { TaskOriginTracker };
