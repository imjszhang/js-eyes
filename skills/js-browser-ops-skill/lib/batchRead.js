'use strict';

const {
  abortReasonCode,
  classifyReadResult,
  hostFromUrl,
  mapThrownError,
  throwIfAborted,
  toErrorPayload,
  toSkillError,
} = require('./skillError');

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeUrlList(urls) {
  if (!Array.isArray(urls)) return [];
  return urls.map((url) => String(url || '').trim()).filter(Boolean);
}

function anySignal(signals) {
  const live = signals.filter(Boolean);
  if (live.length === 0) return undefined;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(live);
  const controller = new AbortController();
  for (const signal of live) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function sleep(ms, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function createSemaphore(max) {
  let active = 0;
  const waiters = [];

  return {
    get active() {
      return active;
    },
    async acquire(signal) {
      throwIfAborted(signal);
      if (active < max) {
        active += 1;
        return;
      }
      await new Promise((resolve, reject) => {
        const entry = { resolve, reject };
        const onAbort = () => {
          const index = waiters.indexOf(entry);
          if (index >= 0) waiters.splice(index, 1);
          try {
            throwIfAborted(signal);
          } catch (error) {
            reject(error);
          }
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
        waiters.push(entry);
      });
      throwIfAborted(signal);
      active += 1;
    },
    release() {
      active = Math.max(0, active - 1);
      const next = waiters.shift();
      next?.resolve?.();
    },
  };
}

function createHostLimiter({ perHostConcurrency, perHostMinIntervalMs }) {
  const hosts = new Map();

  function stateFor(host) {
    const key = host || '';
    if (!hosts.has(key)) {
      hosts.set(key, { active: 0, nextStart: 0 });
    }
    return hosts.get(key);
  }

  return {
    async acquire(host, signal) {
      const state = stateFor(host);
      while (true) {
        throwIfAborted(signal);
        const now = Date.now();
        if (state.active < perHostConcurrency && now >= state.nextStart) {
          state.active += 1;
          state.nextStart = now + perHostMinIntervalMs;
          return;
        }
        const waitMs = state.active < perHostConcurrency
          ? Math.max(1, state.nextStart - now)
          : 20;
        await sleep(waitMs, signal);
      }
    },
    release(host) {
      const state = stateFor(host);
      if (state.active > 0) state.active -= 1;
    },
  };
}

function abortedItemError(signal, fallback = 'cancelled') {
  const code = abortReasonCode(signal) || fallback;
  return toErrorPayload(toSkillError(
    code,
    code === 'timeout' ? 'Operation timed out' : 'Operation cancelled',
  ));
}

async function runBatchReads({
  urls,
  peekCache,
  readOne,
  concurrency = 3,
  perHostMinIntervalMs = 1000,
  perHostConcurrency = 1,
  totalTimeoutMs = 180000,
  signal,
  onProgress,
} = {}) {
  const list = normalizeUrlList(urls);
  if (!list.length) {
    throw toSkillError('invalid_params', '必须提供 urls');
  }

  const globalLimit = createSemaphore(Math.max(1, positiveInteger(concurrency, 3)));
  const hostLimit = createHostLimiter({
    perHostConcurrency: Math.max(1, positiveInteger(perHostConcurrency, 1)),
    perHostMinIntervalMs: Math.max(0, Number(perHostMinIntervalMs) || 0),
  });
  const timeoutSignal = Number(totalTimeoutMs) > 0
    ? AbortSignal.timeout(Number(totalTimeoutMs))
    : null;
  const combined = anySignal([signal, timeoutSignal]);
  const results = new Array(list.length);
  let done = 0;

  const emitProgress = (url, result) => {
    done += 1;
    if (typeof onProgress === 'function') {
      onProgress({ done, total: list.length, url, result });
    }
  };

  const misses = [];
  for (let index = 0; index < list.length; index += 1) {
    const url = list[index];
    if (combined?.aborted) {
      const result = { url, ok: false, error: abortedItemError(combined) };
      results[index] = result;
      emitProgress(url, result);
      continue;
    }
    let cached = null;
    try {
      cached = peekCache ? await peekCache(url) : null;
    } catch (_) {
      cached = null;
    }
    if (cached) {
      const result = { url, ok: true, data: cached };
      results[index] = result;
      emitProgress(url, result);
    } else {
      misses.push({ url, index });
    }
  }

  await Promise.all(misses.map(async ({ url, index }) => {
    const host = hostFromUrl(url);
    try {
      throwIfAborted(combined);
      await globalLimit.acquire(combined);
      try {
        await hostLimit.acquire(host, combined);
        try {
          const data = await readOne(url, { signal: combined });
          const classified = classifyReadResult(data, { host });
          const result = classified
            ? { url, ok: false, error: toErrorPayload(classified) }
            : { url, ok: true, data };
          results[index] = result;
          emitProgress(url, result);
        } finally {
          hostLimit.release(host);
        }
      } finally {
        globalLimit.release();
      }
    } catch (error) {
      const mapped = mapThrownError(error, { host, signal: combined, fallbackCode: 'navigation_failed' });
      const result = { url, ok: false, error: toErrorPayload(mapped) };
      results[index] = result;
      emitProgress(url, result);
    }
  }));

  return results;
}

module.exports = {
  anySignal,
  createHostLimiter,
  createSemaphore,
  normalizeUrlList,
  positiveInteger,
  runBatchReads,
};
