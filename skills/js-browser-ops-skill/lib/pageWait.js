'use strict';

const WAIT_UNTIL = new Set(['domcontentloaded', 'load', 'networkidle', 'selector', 'stable']);

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function resolveWaitOptions(params = {}, options = {}) {
  const waitUntilRaw = params.waitUntil || options.waitUntil || 'load';
  const waitUntil = WAIT_UNTIL.has(waitUntilRaw) ? waitUntilRaw : 'load';
  return {
    waitUntil,
    waitForSelector: params.waitForSelector || options.waitForSelector || null,
    waitTimeoutMs: positiveInteger(params.waitTimeoutMs ?? options.waitTimeoutMs, 8000),
    pollIntervalMs: positiveInteger(params.pollIntervalMs ?? options.pollIntervalMs, 150),
    minContentChars: Math.max(0, Number(params.minContentChars ?? options.minContentChars ?? 80) || 0),
  };
}

function generatePageProbeScript({ waitForSelector } = {}) {
  return `
(function() {
  var selector = ${JSON.stringify(waitForSelector || '')};
  var article = document.querySelector('article, [role="article"], main, [role="main"]');
  var text = article ? (article.innerText || '') : '';
  var lastResource = 0;
  try {
    var entries = performance.getEntriesByType('resource');
    if (entries.length) lastResource = entries[entries.length - 1].responseEnd || 0;
  } catch (e) {}
  var navs = 1;
  try { navs = performance.getEntriesByType('navigation').length || 1; } catch (e) {}
  return {
    probePage: true,
    readyState: document.readyState,
    contentChars: String(text).trim().length,
    href: location.href,
    navigations: navs,
    hasSelector: selector ? Boolean(document.querySelector(selector)) : true,
    networkQuietMs: typeof performance !== 'undefined' ? Math.max(0, performance.now() - lastResource) : 0,
  };
})();
`;
}

function normalizeProbe(raw = {}, fallbackUrl = '') {
  const content = raw.content != null ? String(raw.content).trim() : '';
  return {
    readyState: raw.readyState || 'complete',
    contentChars: Number.isFinite(Number(raw.contentChars))
      ? Number(raw.contentChars)
      : content.length,
    href: raw.href || raw.url || fallbackUrl || '',
    navigations: Number(raw.navigations) > 0 ? Number(raw.navigations) : 1,
    hasSelector: raw.hasSelector !== false,
    networkQuietMs: Number(raw.networkQuietMs) || 0,
  };
}

function waitUntilSatisfied(wait, probe, previousChars) {
  if (wait.waitUntil === 'domcontentloaded') {
    return probe.readyState === 'interactive' || probe.readyState === 'complete';
  }
  if (wait.waitUntil === 'load' || wait.waitUntil === 'networkidle') {
    if (probe.readyState !== 'complete') return false;
    if (wait.waitUntil === 'networkidle') return probe.networkQuietMs >= 500;
    return true;
  }
  if (wait.waitUntil === 'selector') return probe.hasSelector === true;
  if (wait.waitUntil === 'stable') {
    return previousChars >= 0 && probe.contentChars === previousChars && probe.readyState === 'complete';
  }
  return probe.readyState === 'complete';
}

async function sleep(ms, signal) {
  if (signal?.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error('Aborted');
      error.name = 'AbortError';
      reject(error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function decorateReadResult(result, {
  wait,
  waitedMs,
  probe,
  status,
  requestedUrl,
}) {
  const content = status === 'content_too_short' ? '' : (result?.content || '');
  const contentChars = String(content).trim().length || Number(probe?.contentChars) || 0;
  return {
    ...(result || {}),
    content,
    status,
    readyState: probe?.readyState || result?.readyState || 'complete',
    waitedMs,
    contentChars: status === 'content_too_short'
      ? Number(probe?.contentChars) || String(result?.content || '').trim().length
      : contentChars,
    navigations: probe?.navigations || 1,
    finalUrl: probe?.href || result?.url || requestedUrl || '',
    waitUntil: wait.waitUntil,
  };
}

async function readPageAfterWait({
  browser,
  tabId,
  params,
  options,
  format,
  requestedUrl,
  extract,
}) {
  const wait = resolveWaitOptions(params, options);
  const started = Date.now();
  let previousChars = -1;
  let lastProbe = null;
  let extracted = null;

  while (true) {
    const rawProbe = await browser.executeScript(tabId, generatePageProbeScript(wait));
    lastProbe = normalizeProbe(rawProbe, requestedUrl);
    const ready = waitUntilSatisfied(wait, lastProbe, previousChars);
    if (ready) {
      extracted = await extract();
      const chars = String(extracted?.content || '').trim().length;
      if (chars >= wait.minContentChars) {
        return decorateReadResult(extracted, {
          wait,
          waitedMs: Date.now() - started,
          probe: lastProbe,
          status: 'ok',
          requestedUrl,
        });
      }
    }
    if (Date.now() - started >= wait.waitTimeoutMs) break;
    previousChars = lastProbe.contentChars;
    await sleep(wait.pollIntervalMs, options.signal);
  }

  if (!extracted) {
    extracted = await extract();
  }
  const chars = String(extracted?.content || '').trim().length;
  return decorateReadResult(extracted, {
    wait,
    waitedMs: Date.now() - started,
    probe: lastProbe,
    status: chars >= wait.minContentChars ? 'ok' : 'content_too_short',
    requestedUrl,
  });
}

module.exports = {
  WAIT_UNTIL,
  generatePageProbeScript,
  normalizeProbe,
  readPageAfterWait,
  resolveWaitOptions,
  waitUntilSatisfied,
};
