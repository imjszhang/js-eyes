'use strict';

/**
 * js-x-ops-skill 编程 API
 *
 * 提供 4 个纯函数接口，由调用者传入 BrowserAutomation 实例，
 * 返回结构化数据，不做 process.exit、不写文件。
 *
 * READ 且 `useBridge` 未被关闭时：**与 CLI / skill.contract 一致**，经由
 * `lib/runTool.js`（`api_*`/`dom_*`、auto 降级、audit 字段在内部用于抛错，
 * 成功路径结果形状仍与历史 `bridgeAdapter` 输出一致）。
 *
 * 用法:
 *   const { BrowserAutomation } = require('./js-eyes-client');
 *   const { searchTweets, getProfileTweets, getPost, getHomeFeed } = require('./lib/api');
 *   const browser = new BrowserAutomation('ws://localhost:18080');
 *   const result = await searchTweets(browser, 'AI agent', { maxPages: 3 });
 */

const pkg = require('../package.json');
const {
    appendHistory,
    createDebugState,
    createSkillRunContext,
    readCacheEntry,
    recordDomStat,
    recordStep,
    writeCacheEntry,
    writeDebugBundle,
} = require('@js-eyes/skill-recording');
const {
    retryWithBackoff,
    createSafeExecuteScript,
    waitForPageLoad,
    acquireXTab,
    releaseXTab,
    loadGraphQLCache,
    saveGraphQLCache,
    clearGraphQLCache,
    saveProgress,
    appendPartialTweets,
} = require('./xUtils');
const {
    classifyBridgeError,
    FALLBACK_REASON,
} = require('./bridgeAdapter');
const { runTool } = require('./runTool');
const { READ_CMD_DEF } = require('./commands');
const { attachPostMediaDownloads } = require('./postMediaDownload');
const {
  classifyXPostInput,
  canonicalNavigateUrl,
  buildPostBridgeArgs,
  postResultKey,
} = require('./xUrl');

const SKILL_ID = pkg.name;

/** @param {import('./js-eyes-client').BrowserAutomation} browser */

const scriptLoaders = require('./api/script-loaders');
const runtime = require('./api/run-context').createMethods({
  appendHistory, createDebugState, createSkillRunContext, pkg, readCacheEntry, recordDomStat,
  recordStep, SKILL_ID, waitForPageLoad, writeCacheEntry,
});
const runToolMethods = require('./api/run-tool').createMethods({
  buildPostBridgeArgs, canonicalNavigateUrl, classifyXPostInput, getHome: scriptLoaders.getHome,
  getPost_: scriptLoaders.getPost_, getProfile: scriptLoaders.getProfile,
  getSearch: scriptLoaders.getSearch, postResultKey, READ_CMD_DEF, runTool,
});
const bridgeRouting = require('./api/bridge-routing').createMethods({ classifyBridgeError });
const searchMethods = require('./api/search').createMethods({
  ...runtime, acquireXTab, appendPartialTweets, clearGraphQLCache, createSafeExecuteScript,
  getSearch: scriptLoaders.getSearch, loadGraphQLCache, releaseXTab, retryWithBackoff,
  saveGraphQLCache, waitForPageLoad,
});
const profileMethods = require('./api/profile').createMethods({
  ...runtime, acquireXTab, appendPartialTweets, clearGraphQLCache, createSafeExecuteScript,
  getProfile: scriptLoaders.getProfile, loadGraphQLCache, releaseXTab, retryWithBackoff,
  saveGraphQLCache, waitForPageLoad,
});
const postMethods = require('./api/post').createMethods({
  ...runtime, acquireXTab, classifyXPostInput, clearGraphQLCache, createSafeExecuteScript,
  getPost_: scriptLoaders.getPost_, loadGraphQLCache, releaseXTab, retryWithBackoff,
  saveGraphQLCache, waitForPageLoad,
});
const homeMethods = require('./api/home').createMethods({
  ...runtime, acquireXTab, appendPartialTweets, clearGraphQLCache, createSafeExecuteScript,
  getHome: scriptLoaders.getHome, loadGraphQLCache, releaseXTab, retryWithBackoff,
  saveGraphQLCache, waitForPageLoad,
});
const fallbackMethods = require('./api/fallback').createMethods({
  ...bridgeRouting, ...runToolMethods, ...searchMethods, ...profileMethods, ...postMethods, ...homeMethods,
  ...runtime, classifyBridgeError, FALLBACK_REASON,
});
const publicMethods = require('./api/public').createMethods({
  ...bridgeRouting, ...fallbackMethods, ...runtime, ...searchMethods, ...profileMethods, ...postMethods,
  ...homeMethods, appendHistory, attachPostMediaDownloads, buildPostBridgeArgs, classifyXPostInput,
  createDebugState, postResultKey, readCacheEntry, writeCacheEntry, writeDebugBundle,
});

module.exports = {
  searchTweets: publicMethods.searchTweets,
  getProfileTweets: publicMethods.getProfileTweets,
  getPost: publicMethods.getPost,
  getHomeFeed: publicMethods.getHomeFeed,
  postRunToolDispatch: runToolMethods.postRunToolDispatch,
};
