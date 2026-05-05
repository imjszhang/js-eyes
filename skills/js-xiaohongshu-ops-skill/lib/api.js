'use strict';

/**
 * 编程 API（v2.1+）
 *
 * 默认走 bridge（lib/runTool.js → Session → bridges/note-bridge.js 等）。
 * 设 `JS_XHS_DISABLE_BRIDGE=1` 时 `getNote` 退回老路径 (lib/xiaohongshuUtils.js::scrapeXhsNote)，
 * 用于排查 bridge 行为。
 */

const pkg = require('../package.json');
const { runTool } = require('./runTool');
const { processXiaohongshuUrl, isXiaohongshuUrl, normalizeXhsUrl } = require('./xhsUtils');
const { resolveRuntimeConfig } = require('./runtimeConfig');

const SKILL_VERSION = pkg.version;

function defaultRuntimeOptions(options) {
  const runtime = resolveRuntimeConfig({});
  return {
    wsEndpoint: options.serverUrl || options.browserServer || runtime.serverUrl,
    recording: options.recording || runtime.recording,
    runId: options.runId,
    verbose: !!options.verbose,
    navigateOnReuse: options.navigateOnReuse === true,
    reuseAnyXhsTab: options.reuseAnyXhsTab !== false,
  };
}

/**
 * getNote - 读取小红书笔记详情。
 *
 * @param {BrowserAutomation} browser
 * @param {string} url - 笔记 URL（http(s)://www.xiaohongshu.com/explore/<id>?...）或短链
 * @param {Object} [options]
 * @param {boolean} [options.useBridge=true]
 * @param {boolean} [options.withComments]
 * @param {number}  [options.maxCommentPages]
 * @param {string}  [options.readMode]
 */
async function getNote(browser, url, options = {}) {
  const useBridge = options.useBridge !== false && process.env.JS_XHS_DISABLE_BRIDGE !== '1';
  const inputUrl = String(url || '').trim();
  if (!inputUrl) {
    throw new Error('getNote: url 必填');
  }
  const normalized = isXiaohongshuUrl(inputUrl) ? processXiaohongshuUrl(inputUrl) : inputUrl;

  if (!useBridge) {
    const { scrapeXhsNote } = require('./xiaohongshuUtils');
    return scrapeXhsNote(browser, normalized, {
      maxCommentPages: options.maxCommentPages || 0,
    });
  }

  const baseRuntime = defaultRuntimeOptions(options);
  return runTool(browser, {
    toolName: 'xhs_get_note',
    pageKey: 'note',
    method: 'getNote',
    cmdDef: {
      methodBase: 'getNote',
      domSupported: true,
      apiSupported: true,
      defaultReadMode: 'auto',
    },
    args: {
      url: normalized,
      withComments: !!options.withComments,
      maxCommentPages: options.maxCommentPages || 0,
    },
    targetUrl: normalized,
    options: Object.assign(baseRuntime, {
      readMode: options.readMode,
      timeoutMs: options.timeoutMs || 90000,
      createUrl: normalized,
    }),
  });
}

/**
 * getNoteComments - 评论分页（API 主路径）。
 */
async function getNoteComments(browser, url, options = {}) {
  const inputUrl = String(url || '').trim();
  if (!inputUrl) throw new Error('getNoteComments: url 必填');
  const normalized = isXiaohongshuUrl(inputUrl) ? processXiaohongshuUrl(inputUrl) : inputUrl;
  const baseRuntime = defaultRuntimeOptions(options);
  return runTool(browser, {
    toolName: 'xhs_get_note_comments',
    pageKey: 'note',
    method: 'getComments',
    cmdDef: {
      methodBase: 'getComments',
      domSupported: false,
      apiSupported: true,
      defaultReadMode: 'api',
    },
    args: {
      url: normalized,
      maxCommentPages: options.maxCommentPages || 1,
    },
    targetUrl: normalized,
    options: Object.assign(baseRuntime, {
      readMode: options.readMode || 'api',
      timeoutMs: options.timeoutMs || 90000,
      createUrl: normalized,
    }),
  });
}

/**
 * getSessionState - 读取登录态（基于 cookie a1 / web_session 与 DOM 抽用户名）。
 */
async function getSessionState(browser, options = {}) {
  const baseRuntime = defaultRuntimeOptions(options);
  return runTool(browser, {
    toolName: 'xhs_session_state',
    pageKey: 'note',
    method: 'sessionState',
    cmdDef: { legacyOnly: true },
    args: {},
    targetUrl: null,
    options: Object.assign(baseRuntime, {
      timeoutMs: options.timeoutMs || 30000,
      createUrl: 'https://www.xiaohongshu.com/',
    }),
  });
}

module.exports = {
  getNote,
  getNoteComments,
  getSessionState,
  SKILL_VERSION,
};
