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
} = require('@js-eyes/visual-bridge-kit');

const { createRunContext } = require('./runContext');
const {
  generateReadPageScript,
  generateClickScript,
  generateFillFormScript,
  generateWaitForScript,
  generateScrollScript,
  generateScreenshotScript,
} = require('./browserUtils');
const { getVisualHint, buildSummary } = require('./visualHint');

const SKILL_ID = 'js-browser-ops-skill';
const SKILL_VERSION = require('../package.json').version;

const SITE_ANCHOR_PATH = path.join(__dirname, '..', 'bridges', '_visual-browser.js');

/**
 * withVisual - 6 个 api 函数共用的高阶包装。
 *
 * options.visual = { config, tracePath } | undefined
 *   - 缺失或 config.enabled === false → 直接 runScript()，零开销
 *   - 否则 → wrapInjectCall（before+install / 业务 / after+drain），可选 appendVisualTrace
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

  let wrapped;
  let err = null;
  try {
    wrapped = await wrapInjectCall(ctx, hint, runScript, {
      buildSummary: (resp, h, e) => buildSummary(toolName, resp, e),
    });
  } catch (e) {
    err = e;
  }

  if (visual.tracePath) {
    const result = wrapped ? wrapped.result : null;
    const events = wrapped ? wrapped.events : [];
    const summary = wrapped ? wrapped.summary : null;
    const durationMs = wrapped ? wrapped.durationMs : null;
    try {
      appendVisualTrace(visual.tracePath, {
        toolName,
        args: params || {},
        hint,
        ok: !err && !!(summary && summary.ok !== false),
        error: err ? err.message : null,
        durationMs,
        events,
      });
    } catch (_) {}
  }

  if (err) throw err;
  return wrapped.result;
}

async function ensureTab(browser, url, tabId) {
  if (tabId) return tabId;
  if (!url) throw new Error('必须提供 url 或 tabId');
  return browser.openUrl(url);
}

async function readPage(browser, params, options = {}) {
  const { url, tabId, format } = params;
  const startTime = Date.now();

  const runContext = createRunContext({
    skillId: SKILL_ID,
    skillVersion: SKILL_VERSION,
    scrapeType: 'read',
    url: url || `tab:${tabId}`,
    recording: options.recording,
    recordingMode: options.recordingMode,
    debugRecording: options.debugRecording,
    noCache: options.noCache,
    runId: options.runId,
  });

  if (runContext.recording.cacheEnabled && url) {
    const cached = readCacheEntry(runContext, 'read');
    if (cached) {
      appendHistory(runContext, {
        tool: 'browser_read_page',
        input: { url, format },
        cached: true,
        durationMs: Date.now() - startTime,
      });
      return { ...cached, _cached: true, run: { id: runContext.runId } };
    }
  }

  const resolvedTabId = await ensureTab(browser, url, tabId);
  const script = generateReadPageScript(format || 'markdown');
  const result = await withVisual(
    'browser_read_page', browser, resolvedTabId,
    { ...params, tabId: resolvedTabId },
    options,
    () => browser.executeScript(resolvedTabId, script),
  );

  if (runContext.recording.cacheEnabled && url && result) {
    writeCacheEntry(runContext, { response: result }, 'read');
  }
  if (runContext.recording.historyEnabled) {
    appendHistory(runContext, {
      tool: 'browser_read_page',
      input: { url, tabId, format },
      cached: false,
      durationMs: Date.now() - startTime,
    });
  }

  return { ...result, tabId: resolvedTabId, run: { id: runContext.runId } };
}

async function clickElement(browser, params, options = {}) {
  const { tabId, selector, text, index } = params;
  if (!tabId) throw new Error('必须提供 tabId');
  if (!selector && !text) throw new Error('必须提供 selector 或 text');

  const script = generateClickScript(selector || '*', { text, index });
  return withVisual(
    'browser_click', browser, tabId, params, options,
    () => browser.executeScript(tabId, script),
  );
}

async function fillForm(browser, params, options = {}) {
  const { tabId, selector, value, clearFirst, index } = params;
  if (!tabId) throw new Error('必须提供 tabId');
  if (!selector) throw new Error('必须提供 selector');

  const script = generateFillFormScript(selector, value || '', { clearFirst, index });
  return withVisual(
    'browser_fill_form', browser, tabId, params, options,
    () => browser.executeScript(tabId, script),
  );
}

async function waitFor(browser, params, options = {}) {
  const { tabId, selector, timeout, visible } = params;
  if (!tabId) throw new Error('必须提供 tabId');
  if (!selector) throw new Error('必须提供 selector');

  const script = generateWaitForScript(selector, { timeout, visible });
  return withVisual(
    'browser_wait_for', browser, tabId, params, options,
    () => browser.executeScript(tabId, script, { timeout: (timeout || 10) + 5 }),
  );
}

async function scrollPage(browser, params, options = {}) {
  const { tabId, target, selector, pixels } = params;
  if (!tabId) throw new Error('必须提供 tabId');

  const script = generateScrollScript({ target, selector, pixels });
  return withVisual(
    'browser_scroll', browser, tabId, params, options,
    () => browser.executeScript(tabId, script),
  );
}

async function takeScreenshot(browser, params, options = {}) {
  const { tabId } = params;
  if (!tabId) throw new Error('必须提供 tabId');

  const script = generateScreenshotScript();
  return withVisual(
    'browser_screenshot', browser, tabId, params, options,
    () => browser.executeScript(tabId, script),
  );
}

module.exports = {
  readPage,
  clickElement,
  fillForm,
  waitFor,
  scrollPage,
  takeScreenshot,
};
