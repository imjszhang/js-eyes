'use strict';

const {
  readCacheEntry,
  writeCacheEntry,
  appendHistory,
} = require('@js-eyes/skill-recording');

const { createRunContext } = require('./runContext');
const {
  generateReadPageScript,
  generateClickScript,
  generateFillFormScript,
  generateWaitForScript,
  generateScrollScript,
  generateScreenshotScript,
} = require('./browserUtils');

const SKILL_ID = 'js-browser-ops-skill';
const SKILL_VERSION = require('../package.json').version;

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
  const result = await browser.executeScript(resolvedTabId, script);

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
  const result = await browser.executeScript(tabId, script);

  return result;
}

async function fillForm(browser, params, options = {}) {
  const { tabId, selector, value, clearFirst, index } = params;
  if (!tabId) throw new Error('必须提供 tabId');
  if (!selector) throw new Error('必须提供 selector');

  const script = generateFillFormScript(selector, value || '', { clearFirst, index });
  const result = await browser.executeScript(tabId, script);

  return result;
}

async function waitFor(browser, params, options = {}) {
  const { tabId, selector, timeout, visible } = params;
  if (!tabId) throw new Error('必须提供 tabId');
  if (!selector) throw new Error('必须提供 selector');

  const script = generateWaitForScript(selector, { timeout, visible });
  const result = await browser.executeScript(tabId, script, { timeout: (timeout || 10) + 5 });

  return result;
}

async function scrollPage(browser, params, options = {}) {
  const { tabId, target, selector, pixels } = params;
  if (!tabId) throw new Error('必须提供 tabId');

  const script = generateScrollScript({ target, selector, pixels });
  const result = await browser.executeScript(tabId, script);

  return result;
}

async function takeScreenshot(browser, params, options = {}) {
  const { tabId } = params;
  if (!tabId) throw new Error('必须提供 tabId');

  const script = generateScreenshotScript();
  const result = await browser.executeScript(tabId, script);

  return result;
}

module.exports = {
  readPage,
  clickElement,
  fillForm,
  waitFor,
  scrollPage,
  takeScreenshot,
};
