'use strict';

const path = require('path');

const {
  readCacheEntry,
  writeCacheEntry,
  appendHistory,
} = require('@js-eyes/skill-recording');
const {
  wrapInjectCall,
  loadVisualKitSource,
  appendVisualTrace,
  appendVisualSession,
} = require('@js-eyes/visual-bridge-kit');

const {
  createRunContext,
  normalizeReadPageCacheVary,
} = require('./runContext');
const { generateReadPageScript } = require('./browserUtils');
const { readPageAfterWait } = require('./pageWait');
const { authorizeUrlForRead } = require('./egressAllowlist');
const { getVisualHint, buildSummary } = require('./visualHint');
const {
  cleanupTabSession,
  createTabSession,
  resolveKeepOpen,
  resolveTabSession,
} = require('./tabSession');
const { runBatchReads } = require('./batchRead');
const {
  classifyReadResult,
  hostFromUrl,
  mapThrownError,
  throwIfAborted,
  toSkillError,
} = require('./skillError');

const SKILL_ID = 'js-browser-ops-skill';
const SKILL_VERSION = require('../package.json').version;

const SITE_ANCHOR_PATH = path.join(__dirname, '..', 'bridges', '_visual-browser.js');

/**
 * withVisual - 6 个 api 函数共用的高阶包装。
 *
 * options.visual = { config, tracePath?, recordDir? } | undefined
 *   - 缺失或 config.enabled === false → 直接 runScript()，零开销
 *   - 否则 → wrapInjectCall（before+install / 业务 / after+drain）
 *   - tracePath 存在 → appendVisualTrace（单文件 jsonl）
 *   - recordDir 存在 → appendVisualSession（会话包目录，给 hyperframes 重渲染）
 *
 * @param {string} toolName
 * @param {object} browser - BrowserAutomation 实例
 * @param {number} tabId
 * @param {object} params - 工具入参
 * @param {object} options - api 选项（含 visual / recording）
 * @param {() => Promise<any>} runScript - 真正的业务调用（一次 executeScript）
 * @returns {Promise<any>} - 业务结果（与 runScript 返回一致，向后兼容）
 */
async function withVisual(toolName, browser, tabId, params, options, runScript){
  const visual = options && options.visual;
  if (!visual || !visual.config || visual.config.enabled === false || !tabId) {
    return await runScript();
  }

  const hint = getVisualHint(toolName, params || {});
  const ctx = {
    callRaw: (expression, opts) => browser.executeScript(tabId, expression, opts),
    visualConfig: visual.config,
    visualKitSource: loadVisualKitSource({ siteAnchorPath: SITE_ANCHOR_PATH }),
  };

  // post-2.7.0 architecture pivot：browser-ops 这一轮不接 HTML 模板（list/item/tree 都
  // 不适用），也不再走 PNG 路线。captureFrame / frames / redact 已经从主链路下线，
  // 这里走纯 wrapInjectCall + payload-less 录制路径。
  // 如需 dev/debug PNG 截图，可自行 require('@js-eyes/visual-bridge-kit/dev').makeFrameWriter
  // 把 captureFrame 显式塞进 hooks 即可，主链路不会自动启用。
  let wrapped;
  let err = null;
  try {
    wrapped = await wrapInjectCall(ctx, hint, runScript, {
      buildSummary: (resp, h, e) => buildSummary(toolName, resp, e),
    });
  } catch (e) {
    err = e;
  }

  const events = wrapped ? wrapped.events : [];
  const summary = wrapped ? wrapped.summary : null;
  const durationMs = wrapped ? wrapped.durationMs : null;
  const ok = !err && !!(summary && summary.ok !== false);

  if (visual.tracePath) {
    try {
      appendVisualTrace(visual.tracePath, {
        toolName,
        args: params || {},
        hint,
        ok,
        error: err ? err.message : null,
        durationMs,
        events,
      });
    } catch (_) {}
  }

  if (visual.recordDir) {
    try {
      appendVisualSession(visual.recordDir, {
        toolName,
        args: params || {},
        hint,
        ok,
        error: err ? err.message : null,
        durationMs,
        events,
      }, { skillId: SKILL_ID, skillVersion: SKILL_VERSION });
    } catch (_) {}
  }

  if (err) throw err;
  return wrapped.result;
}

async function ensureTab(browser, url, tabId, session, options = {}) {
  const callOptions = { signal: options.signal };
  if (tabId && url) {
    session.assertUsable(tabId, options);
    const opened = await browser.openUrl(url, tabId, null, callOptions);
    if (opened == null || Number(opened) !== Number(tabId)) {
      throw toSkillError('navigation_failed', `无法在标签 ${tabId} 内导航到 ${url}`, {
        host: hostFromUrl(url),
        details: { tabId, url },
      });
    }
    return { tabId: Number(opened), owned: session.owns(opened) };
  }
  if (tabId) {
    session.assertUsable(tabId, options);
    return { tabId, owned: session.owns(tabId) };
  }
  if (!url) throw toSkillError('invalid_params', '必须提供 url 或 tabId');
  const opened = await browser.openUrl(url, null, null, callOptions);
  session.claim(opened);
  return { tabId: opened, owned: true };
}

function decodeCachedReadPage(cached, expectedFormat) {
  if (!cached || cached.format !== expectedFormat) {
    return null;
  }
  if (typeof cached.fetchedAt !== 'string' || Number.isNaN(Date.parse(cached.fetchedAt))) {
    return null;
  }

  const response = cached.response;
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return null;
  }
  if (typeof response.content !== 'string') {
    return null;
  }
  return response;
}

function createReadPageResponse(result, tabId, cached, runId) {
  return {
    ...result,
    tabId,
    _cached: cached,
    run: { id: runId },
  };
}

function buildReadPageRun(params = {}, options = {}) {
  const cacheVary = normalizeReadPageCacheVary(params);
  const format = cacheVary.format;
  const cacheEligible = Boolean(params.url) && !params.tabId;
  const runContext = createRunContext({
    skillId: SKILL_ID,
    skillVersion: SKILL_VERSION,
    scrapeType: 'read',
    url: params.url || `tab:${params.tabId}`,
    format,
    recording: options.recording,
    recordingMode: options.recordingMode,
    debugRecording: options.debugRecording,
    noCache: options.noCache,
    runId: options.runId,
  });
  return { cacheVary, format, cacheEligible, runContext };
}

function peekReadPageCache(params = {}, options = {}) {
  const { format, cacheEligible, runContext } = buildReadPageRun(params, options);
  if (!runContext.recording.cacheEnabled || !cacheEligible) return null;
  const cached = readCacheEntry(runContext, 'read');
  const cachedResponse = decodeCachedReadPage(cached, format);
  if (!cachedResponse) return null;
  return createReadPageResponse(cachedResponse, null, true, runContext.runId);
}

async function readPage(browser, params, options = {}) {
  options = resolveTabOptions(params, options);
  throwIfAborted(options.signal);
  const { url, tabId } = params;
  const startTime = Date.now();
  const { cacheVary, format, cacheEligible, runContext } = buildReadPageRun(params, options);

  const cachedHit = peekReadPageCache(params, options);
  if (cachedHit) {
    appendHistory(runContext, {
      tool: 'browser_read_page',
      input: { url, tabId, format },
      cached: true,
      durationMs: Date.now() - startTime,
    });
    return cachedHit;
  }

  if (url) {
    await authorizeUrlForRead(url, {
      serverUrl: browser.serverUrl,
      policy: browser.policy,
      autoAllowDomain: options.autoAllowDomain,
      persistAllowDomain: options.persistAllowDomain,
      allowPrivateNetwork: options.allowPrivateNetwork,
      runId: options.runId || runContext.runId,
      loadConfig: options.loadConfig,
      saveConfig: options.saveConfig,
      lookup: options.lookup,
    });
  }

  const session = resolveTabSession(browser, options);
  const keepOpen = resolveKeepOpen({
    keepOpen: options.keepOpen ?? params.keepOpen,
    closeAfter: options.closeAfter ?? params.closeAfter,
  });
  let release = () => {};
  let opened = null;
  let cleanup = null;
  try {
    if (!tabId) release = await session.acquire(options.signal);
    opened = await ensureTab(browser, url, tabId, session, options);
    if (keepOpen && opened.owned) session.markKeepOpen(opened.tabId);
    const extractOptions = {
      format: format || 'markdown',
      includeLinks: cacheVary.includeLinks,
      includeImages: cacheVary.includeImages,
      maxContentChars: cacheVary.maxContentChars || undefined,
    };
    const result = await withVisual(
      'browser_read_page', browser, opened.tabId,
      { ...params, tabId: opened.tabId },
      options,
      () => readPageAfterWait({
        browser,
        tabId: opened.tabId,
        params,
        options,
        format: format || 'markdown',
        requestedUrl: url,
        extract: () => runPageExtract(browser, opened.tabId, extractOptions, options),
      }),
    );

    if (runContext.recording.cacheEnabled && cacheEligible && result
      && result.status !== 'content_too_short'
      && result.status !== 'blocked') {
      writeCacheEntry(runContext, {
        response: result,
        fetchedAt: new Date().toISOString(),
        format,
      }, 'read');
    }
    if (runContext.recording.historyEnabled) {
      appendHistory(runContext, {
        tool: 'browser_read_page',
        input: { url, tabId, format },
        cached: false,
        durationMs: Date.now() - startTime,
      });
    }

    if (opened.owned && !keepOpen) {
      const closed = await session.closeOwned(browser, opened.tabId);
      cleanup = closed.cleanup || null;
    }

    const response = createReadPageResponse(
      result,
      keepOpen || !opened.owned ? opened.tabId : null,
      false,
      runContext.runId,
    );
    if (cleanup) response.cleanup = cleanup;
    return response;
  } catch (error) {
    if (opened?.owned && !keepOpen) {
      const closed = await session.closeOwned(browser, opened.tabId);
      if (closed.cleanup) error.cleanup = closed.cleanup;
    }
    throw mapThrownError(error, {
      host: hostFromUrl(url),
      signal: options.signal,
      fallbackCode: 'navigation_failed',
      details: error.cleanup ? { cleanup: error.cleanup } : undefined,
    });
  } finally {
    release();
  }
}

async function readPages(browser, params = {}, options = {}) {
  options = resolveTabOptions(params, options);
  const urls = params.urls;
  const concurrency = Number(params.concurrency) > 0 ? Math.floor(Number(params.concurrency)) : 3;
  const timeoutMs = Number(params.timeoutMs) > 0 ? Number(params.timeoutMs) : 30000;
  const signal = params.signal || options.signal;
  throwIfAborted(signal);

  const ownSession = !(options.tabSession);
  const session = options.tabSession || createTabSession({ maxOpenTabs: concurrency });
  const sharedOptions = {
    ...options,
    tabSession: session,
    signal,
    keepOpen: false,
  };

  try {
    return await runBatchReads({
      urls,
      concurrency,
      perHostMinIntervalMs: params.perHostMinIntervalMs,
      perHostConcurrency: params.perHostConcurrency,
      totalTimeoutMs: params.totalTimeoutMs,
      signal,
      onProgress: params.onProgress || options.onProgress,
      peekCache: async (url) => peekReadPageCache({
        ...params,
        url,
        tabId: undefined,
      }, sharedOptions),
      readOne: async (url, itemOptions) => readPage(browser, {
        url,
        format: params.format,
        waitUntil: params.waitUntil,
        waitForSelector: params.waitForSelector,
        waitTimeoutMs: params.waitTimeoutMs ?? timeoutMs,
        pollIntervalMs: params.pollIntervalMs,
        minContentChars: params.minContentChars,
        maxContentChars: params.maxContentChars,
        includeLinks: params.includeLinks,
        includeImages: params.includeImages,
      }, {
        ...sharedOptions,
        signal: itemOptions.signal || signal,
      }),
    });
  } finally {
    if (ownSession) {
      try { await session.cleanup(browser); } catch (_) {}
    }
  }
}

async function runPageExtract(browser, tabId, extractOptions, options) {
  if (typeof browser.extractPage === 'function') {
    return browser.extractPage(tabId, extractOptions, options);
  }
  try {
    return await browser.executeScript(tabId, generateReadPageScript(extractOptions), options);
  } catch (error) {
    throw mapThrownError(error, { fallbackCode: 'eval_denied' });
  }
}

function resolveTabOptions(params = {}, options = {}) {
  return {
    ...options,
    allowExternalTab: options.allowExternalTab ?? params.allowExternalTab === true,
    keepOpen: options.keepOpen ?? params.keepOpen,
    closeAfter: options.closeAfter ?? params.closeAfter,
  };
}

function assertOwnedTab(browser, tabId, options = {}) {
  try {
    resolveTabSession(browser, options).assertUsable(tabId, options);
  } catch (error) {
    throw mapThrownError(error, { fallbackCode: 'tab_not_found' });
  }
}

async function wrapAction(name, fn, extras = {}) {
  try {
    throwIfAborted(extras.signal);
    return await fn();
  } catch (error) {
    throw mapThrownError(error, extras);
  }
}

async function clickElement(browser, params, options = {}) {
  const { tabId, selector, text, index } = params;
  if (!tabId) throw toSkillError('invalid_params', '必须提供 tabId');
  assertOwnedTab(browser, tabId, resolveTabOptions(params, options));
  if (!selector && !text) throw toSkillError('invalid_params', '必须提供 selector 或 text');
  if (typeof browser.click !== 'function') {
    throw toSkillError('invalid_params', 'Browser client does not support first-class click (upgrade JS Eyes extension/SDK)');
  }

  return wrapAction('browser_click', () => withVisual(
    'browser_click', browser, tabId, params, options,
    () => browser.click(tabId, { selector, text, index }, options),
  ), { signal: options.signal, fallbackCode: 'timeout' });
}

async function fillForm(browser, params, options = {}) {
  const { tabId, selector, value, clearFirst, index } = params;
  if (!tabId) throw toSkillError('invalid_params', '必须提供 tabId');
  assertOwnedTab(browser, tabId, resolveTabOptions(params, options));
  if (!selector) throw toSkillError('invalid_params', '必须提供 selector');
  if (typeof browser.fill !== 'function') {
    throw toSkillError('invalid_params', 'Browser client does not support first-class fill (upgrade JS Eyes extension/SDK)');
  }

  return wrapAction('browser_fill_form', () => withVisual(
    'browser_fill_form', browser, tabId, params, options,
    () => browser.fill(tabId, { selector, value: value || '', clearFirst, index }, options),
  ), { signal: options.signal, fallbackCode: 'timeout' });
}

async function waitFor(browser, params, options = {}) {
  const { tabId, selector, timeout, visible } = params;
  if (!tabId) throw toSkillError('invalid_params', '必须提供 tabId');
  assertOwnedTab(browser, tabId, resolveTabOptions(params, options));
  if (!selector) throw toSkillError('invalid_params', '必须提供 selector');
  if (typeof browser.waitFor !== 'function') {
    throw toSkillError('invalid_params', 'Browser client does not support first-class waitFor (upgrade JS Eyes extension/SDK)');
  }

  return wrapAction('browser_wait_for', () => withVisual(
    'browser_wait_for', browser, tabId, params, options,
    () => browser.waitFor(tabId, { selector, timeout, visible }, options),
  ), { signal: options.signal, fallbackCode: 'timeout' });
}

async function scrollPage(browser, params, options = {}) {
  const { tabId, target, selector, pixels } = params;
  if (!tabId) throw toSkillError('invalid_params', '必须提供 tabId');
  assertOwnedTab(browser, tabId, resolveTabOptions(params, options));
  if (typeof browser.scroll !== 'function') {
    throw toSkillError('invalid_params', 'Browser client does not support first-class scroll (upgrade JS Eyes extension/SDK)');
  }

  return wrapAction('browser_scroll', () => withVisual(
    'browser_scroll', browser, tabId, params, options,
    () => browser.scroll(tabId, { scrollTarget: target, selector, pixels }, options),
  ), { signal: options.signal, fallbackCode: 'timeout' });
}

async function takeScreenshot(browser, params, options = {}) {
  const { tabId, fullPage, format, quality } = params;
  if (!tabId) throw toSkillError('invalid_params', '必须提供 tabId');
  assertOwnedTab(browser, tabId, resolveTabOptions(params, options));

  return wrapAction('browser_screenshot', () => withVisual(
    'browser_screenshot', browser, tabId, params, options,
    () => browser.captureScreenshot(tabId, {
      fullPage,
      format,
      quality,
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  ), { signal: options.signal, fallbackCode: 'timeout' });
}

module.exports = {
  classifyReadResult,
  peekReadPageCache,
  readPage,
  readPages,
  clickElement,
  fillForm,
  waitFor,
  scrollPage,
  takeScreenshot,
  cleanupTabSession,
};
