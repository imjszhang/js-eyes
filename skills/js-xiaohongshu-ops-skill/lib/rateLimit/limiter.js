'use strict';

/**
 * 单进程令牌桶 + 调用间隔控制（裁剪自 agent-js xhsScraperService::XhsApiRateLimiter）。
 *
 * 用法：
 *   const limiter = new XhsLimiter({ minIntervalMs: 1500, maxRandomDelayMs: 800, maxConcurrent: 2 });
 *   await limiter.schedule(async () => { ... });
 *
 * 不引入 IPC；多进程共享留扩展点（v3.x 不做）。
 */

class XhsLimiter {
  /**
   * @param {Object} options
   * @param {number} [options.minIntervalMs=1500]
   * @param {number} [options.maxRandomDelayMs=800]
   * @param {number} [options.maxConcurrent=2]
   * @param {number} [options.bucketCapacity=4]   令牌桶容量
   * @param {number} [options.refillIntervalMs=1500]  每多久补 1 token
   */
  constructor(options = {}) {
    this.minIntervalMs = options.minIntervalMs || 1500;
    this.maxRandomDelayMs = options.maxRandomDelayMs || 800;
    this.maxConcurrent = options.maxConcurrent || 2;
    this.bucketCapacity = options.bucketCapacity || 4;
    this.refillIntervalMs = options.refillIntervalMs || this.minIntervalMs;

    this._tokens = this.bucketCapacity;
    this._lastRefillAt = Date.now();
    this._lastDispatchAt = 0;
    this._inflight = 0;
    this._waiters = [];
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this._lastRefillAt;
    if (elapsed <= 0) return;
    const refill = Math.floor(elapsed / this.refillIntervalMs);
    if (refill > 0) {
      this._tokens = Math.min(this.bucketCapacity, this._tokens + refill);
      this._lastRefillAt += refill * this.refillIntervalMs;
    }
  }

  _wakeup() {
    while (this._waiters.length && this._inflight < this.maxConcurrent && this._tokens > 0) {
      const w = this._waiters.shift();
      this._tokens -= 1;
      this._inflight += 1;
      w();
    }
  }

  async _acquire() {
    this._refill();
    if (this._inflight < this.maxConcurrent && this._tokens > 0) {
      this._tokens -= 1;
      this._inflight += 1;
      return;
    }
    return new Promise((resolve) => {
      this._waiters.push(resolve);
    });
  }

  _release() {
    this._inflight = Math.max(0, this._inflight - 1);
    this._wakeup();
  }

  async _waitForGap() {
    const now = Date.now();
    const since = now - this._lastDispatchAt;
    const jitter = Math.floor(Math.random() * this.maxRandomDelayMs);
    const delay = Math.max(0, this.minIntervalMs - since) + jitter;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    this._lastDispatchAt = Date.now();
  }

  /**
   * schedule(fn) - 在限流前提下执行 fn。
   */
  async schedule(fn) {
    await this._acquire();
    try {
      await this._waitForGap();
      return await fn();
    } finally {
      this._release();
    }
  }

  /**
   * 自动每 refillIntervalMs 触发一次唤醒（即使没人 release）。
   */
  startAutoRefill() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this._refill();
      this._wakeup();
    }, this.refillIntervalMs).unref?.();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  snapshot() {
    return {
      tokens: this._tokens,
      inflight: this._inflight,
      waiters: this._waiters.length,
      lastDispatchAt: this._lastDispatchAt,
      maxConcurrent: this.maxConcurrent,
      bucketCapacity: this.bucketCapacity,
    };
  }
}

let _shared = null;
function getSharedLimiter(options) {
  if (!_shared) _shared = new XhsLimiter(options);
  return _shared;
}

module.exports = { XhsLimiter, getSharedLimiter };
