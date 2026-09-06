'use strict';

const crypto = require('node:crypto');

class TabOwnershipError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TabOwnershipError';
    this.code = details.code || 'tab_not_owned';
    this.retryable = false;
    this.details = details;
  }
}

class TabSession {
  constructor(options = {}) {
    this.id = options.id || crypto.randomUUID();
    this.maxOpenTabs = Number(options.maxOpenTabs) > 0 ? Number(options.maxOpenTabs) : 4;
    this.owned = new Set();
    this.keepOpen = new Set();
    this.queue = [];
    this.inUse = 0;
  }

  owns(tabId) {
    return this.owned.has(Number(tabId));
  }

  claim(tabId) {
    const id = Number(tabId);
    if (!Number.isFinite(id)) return null;
    this.owned.add(id);
    return id;
  }

  markKeepOpen(tabId) {
    const id = Number(tabId);
    if (this.owned.has(id)) this.keepOpen.add(id);
  }

  assertUsable(tabId, { allowExternalTab = false } = {}) {
    const id = Number(tabId);
    if (this.owns(id)) return id;
    if (allowExternalTab) return id;
    throw new TabOwnershipError(
      `Tab ${id} is not owned by this session. Pass allowExternalTab to opt in.`,
      { code: 'tab_not_owned', tabId: id, sessionId: this.id },
    );
  }

  hasCapacity() {
    return this.inUse < this.maxOpenTabs && this.owned.size < this.maxOpenTabs;
  }

  promote() {
    if (!this.queue.length || !this.hasCapacity()) return;
    const next = this.queue.shift();
    next?.resolve?.();
  }

  abortError(message = 'Aborted') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }

  async acquire(signal) {
    while (true) {
      if (signal?.aborted) throw this.abortError();
      if (this.hasCapacity()) {
        this.inUse += 1;
        return () => this.release();
      }
      await new Promise((resolve, reject) => {
        const entry = { resolve, reject };
        const onAbort = () => {
          this.queue = this.queue.filter((item) => item !== entry);
          reject(this.abortError());
        };
        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
          entry.resolve = () => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          };
        }
        this.queue.push(entry);
      });
    }
  }

  release() {
    if (this.inUse > 0) this.inUse -= 1;
    this.promote();
  }

  async closeOwned(browser, tabId, { force = false } = {}) {
    const id = Number(tabId);
    if (!this.owns(id)) return { closed: false };
    if (!force && this.keepOpen.has(id)) return { closed: false, kept: true };
    try {
      if (typeof browser.closeTab === 'function') {
        await browser.closeTab(id);
      }
      this.owned.delete(id);
      this.keepOpen.delete(id);
      this.promote();
      return { closed: true };
    } catch (error) {
      return {
        closed: false,
        cleanup: {
          code: 'tab_cleanup_failed',
          tabId: id,
          retryable: true,
        },
        error,
      };
    }
  }

  async cleanup(browser) {
    this.queue.splice(0).forEach((entry) => {
      entry.reject?.(this.abortError('Session cleaned up'));
    });
    this.inUse = 0;
    const leftover = [...this.owned];
    const results = [];
    for (const tabId of leftover) {
      results.push(await this.closeOwned(browser, tabId, { force: true }));
    }
    return results;
  }
}

const sessionsByBrowser = new WeakMap();

function createTabSession(options = {}) {
  return new TabSession(options);
}

function resolveTabSession(browser, options = {}) {
  if (options.tabSession instanceof TabSession) return options.tabSession;
  const key = options.sessionId || 'default';
  let byId = sessionsByBrowser.get(browser);
  if (!byId) {
    byId = new Map();
    sessionsByBrowser.set(browser, byId);
  }
  if (!byId.has(key)) {
    byId.set(key, createTabSession({
      id: key,
      maxOpenTabs: options.maxOpenTabs,
    }));
  }
  return byId.get(key);
}

async function cleanupTabSession(browser, options = {}) {
  const session = resolveTabSession(browser, options);
  return session.cleanup(browser);
}

function resolveKeepOpen(options = {}) {
  if (options.keepOpen === true && options.closeAfter === true) {
    throw new Error('keepOpen and closeAfter cannot both be true');
  }
  if (options.keepOpen === true) return true;
  if (options.closeAfter === false) return true;
  return false;
}

module.exports = {
  TabOwnershipError,
  TabSession,
  cleanupTabSession,
  createTabSession,
  resolveKeepOpen,
  resolveTabSession,
};
