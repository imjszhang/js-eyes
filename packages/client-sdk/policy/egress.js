'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { hostMatches, parseOriginFromUrl, normalizeHost } = require('./origin-utils');

class EgressGate {
  constructor(options = {}) {
    this.staticAllowlist = Array.isArray(options.allowlist) ? options.allowlist.slice() : [];
    this.sessionAllowlist = new Set();
    this.taskOrigin = options.taskOrigin || null;
    this.pendingDir = options.pendingDir || null;
    this.logger = options.logger || null;
  }

  setPendingDir(dir) {
    this.pendingDir = dir;
  }

  allowSession(domain) {
    const host = normalizeHost(domain);
    if (host) this.sessionAllowlist.add(host);
  }

  addStatic(domain) {
    const host = normalizeHost(domain);
    if (host && !this.staticAllowlist.includes(host)) {
      this.staticAllowlist.push(host);
    }
  }

  isAllowed(targetHost) {
    const host = normalizeHost(targetHost);
    if (!host) return false;
    if (this.taskOrigin && this.taskOrigin.isInScope(host)) return true;
    for (const pattern of this.staticAllowlist) {
      if (hostMatches(host, pattern)) return true;
    }
    for (const pattern of this.sessionAllowlist) {
      if (hostMatches(host, pattern)) return true;
    }
    return false;
  }

  evaluateUrl(url) {
    const host = parseOriginFromUrl(url);
    if (!host) {
      return { decision: 'allow', reason: 'unparseable-url', host: null };
    }
    if (this.isAllowed(host)) {
      return { decision: 'allow', host };
    }
    return { decision: 'pending-egress', reason: 'egress-not-allowlisted', host };
  }

  writePending(entry) {
    if (!this.pendingDir) return null;
    const id = entry.id || `eg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const file = path.join(this.pendingDir, `${id}.json`);
    const record = {
      id,
      ts: new Date().toISOString(),
      ...entry,
    };
    try {
      fs.mkdirSync(this.pendingDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
      try { fs.chmodSync(file, 0o600); } catch {}
      return { id, file };
    } catch (err) {
      this.logger?.warn?.(`[js-eyes] pending-egress write failed: ${err.message}`);
      return null;
    }
  }

  listPending() {
    if (!this.pendingDir || !fs.existsSync(this.pendingDir)) return [];
    const entries = [];
    for (const name of fs.readdirSync(this.pendingDir)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(this.pendingDir, name);
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        entries.push({ ...data, file });
      } catch {
        entries.push({ id: name.replace(/\.json$/, ''), file, broken: true });
      }
    }
    return entries;
  }

  removePending(id) {
    if (!this.pendingDir) return false;
    const file = path.join(this.pendingDir, `${id}.json`);
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

module.exports = { EgressGate };
