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
  resolveKeepOpen,
  resolveTabSession,
} = require('./tabSession');

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
  if (tabId && url) {
    session.assertUsable(tabId, options);
    const opened = await browser.openUrl(url, tabId);
    if (opened == null || Number(opened) !== Number(tabId)) {
      throw new Error(`无法在标签 ${tabId} 内导航到 ${url}`);
    }
    return { tabId: Number(opened), owned: session.owns(opened) };
  }
  if (tabId) {
    session.assertUsable(tabId, options);
    return { tabId, owned: session.owns(tabId) };
  }
  if (!url) throw new Error('必须提供 url 或 tabId');
  const opened = await browser.openUrl(url);
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

async function readPage(browser, params, options = {}) {
  options = resolveTabOptions(params, options);
  const { url, tabId } = params;
  const cacheVary = normalizeReadPageCacheVary(params);
  const format = cacheVary.format;
  const cacheEligible = Boolean(url) && !tabId;
  const startTime = Date.now();

  const runContext = createRunContext({
    skillId: SKILL_ID,
    skillVersion: SKILL_VERSION,
    scrapeType: 'read',
    url: url || `tab:${tabId}`,
    format,
    recording: options.recording,
    recordingMode: options.recordingMode,
    debugRecording: options.debugRecording,
    noCache: options.noCache,
    runId: options.runId,
  });

  if (runContext.recording.cacheEnabled && cacheEligible) {
    const cached = readCacheEntry(runContext, 'read');
    const cachedResponse = decodeCachedReadPage(cached, format);
    if (cachedResponse) {
      appendHistory(runContext, {
        tool: 'browser_read_page',
        input: { url, tabId, format },
        cached: true,
        durationMs: Date.now() - startTime,
      });
      return createReadPageResponse(
        cachedResponse,
        null,
        true,
        runContext.runId,
      );
    }
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
  const release = tabId
    ? () => {}
    : await session.acquire(options.signal);
  let opened = null;
  let cleanup = null;
  try {
    opened = await ensureTab(browser, url, tabId, session, options);
    if (keepOpen && opened.owned) session.markKeepOpen(opened.tabId);
    const script = generateReadPageScript(format || 'markdown');
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
        extract: () => browser.executeScript(opened.tabId, script),
      }),
    );

    if (runContext.recording.cacheEnabled && cacheEligible && result && result.status !== 'content_too_short') {
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
    throw error;
  } finally {
    release();
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
  resolveTabSession(browser, options).assertUsable(tabId, options);
}

async function clickElement(browser, params, options = {}) {
  const { tabId, selector, text, index } = params;
  if (!tabId) throw new Error('必须提供 tabId');
  assertOwnedTab(browser, tabId, resolveTabOptions(params, options));
  if (!selector && !text) throw new Error('必须提供 selector 或 text');
  if (typeof browser.click !== 'function') {
    throw new Error('Browser client does not support first-class click (upgrade JS Eyes extension/SDK)');
  }

  return withVisual(
    'browser_click', browser, tabId, params, options,
    () => browser.click(tabId, { selector, text, index }, options),
  );
}

async function fillForm(browser, params, options = {}) {
  const { tabId, selector, value, clearFirst, index } = params;
  if (!tabId) throw new Error('必须提供 tabId');
  assertOwnedTab(browser, tabId, resolveTabOptions(params, options));
  if (!selector) throw new Error('必须提供 selector');
  if (typeof browser.fill !== 'function') {
    throw new Error('Browser client does not support first-class fill (upgrade JS Eyes extension/SDK)');
  }

  return withVisual(
    'browser_fill_form', browser, tabId, params, options,
    () => browser.fill(tabId, { selector, value: value || '', clearFirst, index }, options),
  );
}

async function waitFor(browser, params, options = {}) {
  const { tabId, selector, timeout, visible } = params;
  if (!tabId) throw new Error('必须提供 tabId');
  assertOwnedTab(browser, tabId, resolveTabOptions(params, options));
  if (!selector) throw new Error('必须提供 selector');
  if (typeof browser.waitFor !== 'function') {
    throw new Error('Browser client does not support first-class waitFor (upgrade JS Eyes extension/SDK)');
  }

  return withVisual(
    'browser_wait_for', browser, tabId, params, options,
    () => browser.waitFor(tabId, { selector, timeout, visible }, options),
  );
}

async function scrollPage(browser, params, options = {}) {
  const { tabId, target, selector, pixels } = params;
  if (!tabId) throw new Error('必须提供 tabId');
  assertOwnedTab(browser, tabId, resolveTabOptions(params, options));
  if (typeof browser.scroll !== 'function') {
    throw new Error('Browser client does not support first-class scroll (upgrade JS Eyes extension/SDK)');
  }

  return withVisual(
    'browser_scroll', browser, tabId, params, options,
    () => browser.scroll(tabId, { scrollTarget: target, selector, pixels }, options),
  );
}

async function takeScreenshot(browser, params, options = {}) {
  const { tabId, fullPage, format, quality } = params;
  if (!tabId) throw new Error('必须提供 tabId');
  assertOwnedTab(browser, tabId, resolveTabOptions(params, options));

  return withVisual(
    'browser_screenshot', browser, tabId, params, options,
    () => browser.captureScreenshot(tabId, { fullPage, format, quality }),
  );
}

module.exports = {
  readPage,
  clickElement,
  fillForm,
  waitFor,
  scrollPage,
  takeScreenshot,
  cleanupTabSession,
};
