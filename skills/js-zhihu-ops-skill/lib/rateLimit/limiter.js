'use strict';

class ZhihuLimiter {
  constructor(options = {}) {
    this.minIntervalMs = options.minIntervalMs || 1200;
    this.maxRandomDelayMs = options.maxRandomDelayMs || 500;
    this.maxConcurrent = options.maxConcurrent || 2;
    this._lastDispatchAt = 0;
    this._inflight = 0;
    this._waiters = [];
  }

  async _acquire() {
    if (this._inflight < this.maxConcurrent) {
      this._inflight += 1;
      return;
    }
    await new Promise((resolve) => this._waiters.push(resolve));
    this._inflight += 1;
  }

  _release() {
    this._inflight = Math.max(0, this._inflight - 1);
    const next = this._waiters.shift();
    if (next) next();
  }

  async _waitForGap() {
    const now = Date.now();
    const since = now - this._lastDispatchAt;
    const jitter = Math.floor(Math.random() * this.maxRandomDelayMs);
    const delay = Math.max(0, this.minIntervalMs - since) + jitter;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this._lastDispatchAt = Date.now();
  }

  async schedule(fn) {
    await this._acquire();
    try {
      await this._waitForGap();
      return await fn();
    } finally {
      this._release();
    }
  }

  snapshot() {
    return {
      inflight: this._inflight,
      waiters: this._waiters.length,
      lastDispatchAt: this._lastDispatchAt,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

let shared = null;
function getSharedLimiter(options) {
  if (!shared) shared = new ZhihuLimiter(options);
  return shared;
}

module.exports = { ZhihuLimiter, getSharedLimiter };
