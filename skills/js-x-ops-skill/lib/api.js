'use strict';

/**
 * js-x-ops-skill 编程 API
 *
 * 提供 4 个纯函数接口，由调用者传入 BrowserAutomation 实例，
 * 返回结构化数据，不做 process.exit、不写文件。
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
    searchViaBridge,
    profileViaBridge,
    postViaBridge,
    homeViaBridge,
    classifyBridgeError,
    FALLBACK_REASON,
} = require('./bridgeAdapter');

const SKILL_ID = pkg.name;

/**
 * 内部双轨开关：
 * - JS_X_DISABLE_BRIDGE=1   直接走老的 runXxx 路径（v2.0.1 行为）
 * - JS_X_DISABLE_FALLBACK=1 bridge 失败直接抛错（用于 schema diff / 排查）
 *
 * options.useBridge=false 等价于 JS_X_DISABLE_BRIDGE=1（编程入口可单次关闭）。
 */
function _shouldUseBridge(options) {
    if (options && options.useBridge === false) return false;
    if (process.env.JS_X_DISABLE_BRIDGE === '1') return false;
    return true;
}

function _shouldFallback() {
    return process.env.JS_X_DISABLE_FALLBACK !== '1';
}

function _attachBridgeMetrics(result, info) {
    result._bridgeRoute = {
        bridgeUsed: !!info.bridgeUsed,
        bridgeFallback: !!info.bridgeFallback,
        bridgeFallbackReason: info.bridgeFallbackReason || null,
        bridgeFallbackMessage: info.bridgeFallbackMessage || null,
        bridgeFallbackCode: info.bridgeFallbackCode || null,
        bridgeTarget: info.bridgeTarget || null,
        bridgeVersion: info.bridgeVersion || null,
        bridgeMeta: info.bridgeMeta || null,
    };
    return result;
}

function _readBridgeRoute(result) {
    const route = (result && result._bridgeRoute) || null;
    if (result && result._bridgeRoute) delete result._bridgeRoute;
    return route;
}

// Lazy-load script modules to avoid circular dependency
// (scripts import api.js, api.js imports scripts)
let _search, _profile, _post, _home;
function getSearch()  { return _search  || (_search  = require('../scripts/x-search')); }
function getProfile() { return _profile || (_profile = require('../scripts/x-profile')); }
function getPost_()   { return _post    || (_post    = require('../scripts/x-post')); }
function getHome()    { return _home    || (_home    = require('../scripts/x-home')); }

// ============================================================================
// 通用内部辅助
// ============================================================================

function noop() {}
function makeLog(logger) {
    if (!logger) return { log: noop, warn: noop, error: noop };
    return {
        log:   logger.log   || logger.info || noop,
        warn:  logger.warn  || noop,
        error: logger.error || noop,
    };
}

async function openAndWait(browser, tabId, url, safeExec, log) {
    try {
        await safeExec(tabId, 'performance.clearResourceTimings(); void 0;', { timeout: 5 });
        await browser.openUrl(url, tabId);
        try { await waitForPageLoad(browser, tabId, { timeout: 30000 }); } catch (_) {}
        await new Promise(r => setTimeout(r, 4000));
    } catch (e) {
        log.warn(`⚠ 页面刷新失败: ${e.message}`);
    }
}

function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : value;
}

function summarizeInput(value) {
    try {
        return JSON.stringify(value);
    } catch (_) {
        return String(value);
    }
}

function createRecordingLogger(logger, debugState) {
    const base = makeLog(logger);
    const createForwarder = (level) => (...args) => {
        const message = args.map((value) => String(value)).join(' ');
        recordStep(debugState, 'log', { level, message });
        base[level](...args);
    };

    return {
        log: createForwarder('log'),
        warn: createForwarder('warn'),
        error: createForwarder('error'),
    };
}

function createXRunContext(scrapeType, input, options = {}) {
    return createSkillRunContext({
        skillId: SKILL_ID,
        toolName: scrapeType,
        scrapeType,
        skillVersion: pkg.version,
        input,
        recording: options.recording,
        recordingMode: options.recordingMode,
        debugRecording: options.debugRecording,
        noCache: options.noCache,
        normalizeInput: (value) => value,
        buildCacheKeyParts: ({ skillId, toolName, normalizedInput, skillVersion }) => ({
            skillId,
            toolName,
            input: normalizedInput,
            version: skillVersion,
        }),
    });
}

function buildXMetrics(scrapeType, result, durationMs, cacheHit) {
    const route = result && result._bridgeRoute ? result._bridgeRoute : {};
    const bridgeFields = {
        bridgeUsed: route.bridgeUsed === true,
        bridgeFallback: route.bridgeFallback === true,
        bridgeFallbackReason: route.bridgeFallbackReason || null,
        bridgeFallbackMessage: route.bridgeFallbackMessage || null,
        bridgeFallbackCode: route.bridgeFallbackCode || null,
        bridgeVersion: route.bridgeVersion || null,
    };

    if (scrapeType === 'x_post') {
        return {
            status: result.totalFailed > 0 ? 'partial' : 'success',
            durationMs,
            cacheHit,
            totalRequested: result.totalRequested ?? 0,
            totalSuccess: result.totalSuccess ?? 0,
            totalFailed: result.totalFailed ?? 0,
            ...bridgeFields,
        };
    }

    return {
        status: 'success',
        durationMs,
        cacheHit,
        totalResults: result.totalResults ?? (Array.isArray(result.results) ? result.results.length : 0),
        ...bridgeFields,
    };
}

function buildXResponse(runContext, result, durationMs, cacheMeta = {}) {
    return {
        ...result,
        platform: 'x',
        scrapeType: runContext.scrapeType,
        run: {
            id: runContext.runId,
            cacheHit: cacheMeta.hit === true,
            recordingMode: runContext.recording.mode,
        },
        cache: {
            hit: cacheMeta.hit === true,
            key: runContext.cacheKey,
            createdAt: cacheMeta.createdAt || null,
            expiresAt: cacheMeta.expiresAt || null,
        },
        metrics: buildXMetrics(runContext.scrapeType, result, durationMs, cacheMeta.hit === true),
    };
}

function buildXHistoryEntry(runContext, response, options = {}) {
    const metrics = response?.metrics || {};
    return {
        run_id: runContext.runId,
        skill_id: runContext.skillId,
        tool_name: runContext.scrapeType,
        timestamp: new Date().toISOString(),
        input_summary: summarizeInput(runContext.normalizedInput),
        status: options.status || metrics.status || 'success',
        duration_ms: options.durationMs,
        cache_hit: options.cacheHit === true,
        cache_key: runContext.cacheKey,
        debug_bundle_path: options.debugBundlePath || '',
        error_summary: options.errorSummary || '',
        total_results: metrics.totalResults ?? null,
        total_requested: metrics.totalRequested ?? null,
        total_success: metrics.totalSuccess ?? null,
        total_failed: metrics.totalFailed ?? null,
    };
}

function attachXCacheHit(runContext, cached, startedAtMs) {
    if (!cached?.response) {
        return null;
    }

    const cacheDurationMs = Date.now() - startedAtMs;
    const response = clone(cached.response);
    response.run = {
        id: runContext.runId,
        cacheHit: true,
        recordingMode: runContext.recording.mode,
    };
    response.cache = {
        hit: true,
        key: runContext.cacheKey,
        createdAt: cached.createdAt || null,
        expiresAt: cached.expiresAt || null,
    };
    if (response.metrics) {
        response.metrics.cacheHit = true;
        response.metrics.durationMs = cacheDurationMs;
    }
    appendHistory(runContext, buildXHistoryEntry(runContext, response, {
        durationMs: cacheDurationMs,
        cacheHit: true,
    }));
    return response;
}

// ============================================================================
// searchTweets
// ============================================================================

/**
 * 搜索 X.com 推文
 *
 * @param {import('./js-eyes-client').BrowserAutomation} browser
 * @param {string} keyword 搜索关键词
 * @param {object} [options]
 * @param {number}  [options.maxPages=1]
 * @param {string}  [options.sort='top']       top | latest | media
 * @param {number}  [options.minLikes=0]
 * @param {number}  [options.minRetweets=0]
 * @param {number}  [options.minReplies=0]
 * @param {string}  [options.lang]
 * @param {string}  [options.from]
 * @param {string}  [options.to]
 * @param {string}  [options.since]            YYYY-MM-DD
 * @param {string}  [options.until]            YYYY-MM-DD
 * @param {boolean} [options.excludeReplies]
 * @param {boolean} [options.excludeRetweets]
 * @param {boolean} [options.hasLinks]
 * @param {boolean} [options.closeTab=false]
 * @param {object}  [options.logger]           可选 logger ({ log, warn, error })
 * @param {string}  [options._outputDir]       可选，传入后启用增量保存
 * @returns {Promise<{searchKeyword,searchUrl,searchOptions,timestamp,totalResults,results}>}
 */
async function runSearchTweets(browser, keyword, options = {}) {
    const opts = {
        maxPages: 1, sort: 'top',
        minLikes: 0, minRetweets: 0, minReplies: 0,
        lang: null, from: null, to: null, since: null, until: null,
        excludeReplies: false, excludeRetweets: false, hasLinks: false,
        closeTab: false,
        ...options,
    };
    const log = makeLog(opts.logger);

    const S = getSearch();
    const fullQuery  = S.buildFullQuery(keyword, opts);
    const searchUrl  = S.buildSearchUrl(keyword, opts);
    const product    = S.sortToProduct(opts.sort);

    const safeExecuteScript = createSafeExecuteScript(browser);
    let tabId = null;
    const allTweets = [];
    const seenIds   = new Set();

    let pageDelay = 1500;
    const MIN_PAGE_DELAY = 1500;
    const MAX_PAGE_DELAY = 5000;

    try {
        // Phase 1: 打开搜索页
        log.log('[Phase 1] 打开搜索页面...');
        const tabResult = await acquireXTab(browser, searchUrl);
        tabId = tabResult.tabId;

        if (!tabResult.isReused || tabResult.navigated) {
            try { await waitForPageLoad(browser, tabId, { timeout: 30000 }); } catch (_) {}
        }
        const renderWait = tabResult.isReused && !tabResult.navigated ? 1000 : 3000;
        await new Promise(r => setTimeout(r, renderWait));

        // Phase 2: GraphQL 参数发现
        let graphqlFailed = !S.ENABLE_GRAPHQL_SEARCH;

        if (S.ENABLE_GRAPHQL_SEARCH) {
            log.log('[Phase 2] 获取 GraphQL 参数...');
            let graphqlParams = {};

            const cached = await loadGraphQLCache('SearchTimeline');
            if (cached && cached.queryId) {
                graphqlParams = cached;
                log.log(`✓ 使用缓存的 queryId: ${cached.queryId}`);
            } else {
                try {
                    const disc = await safeExecuteScript(tabId, S.buildDiscoverGraphQLParamsScript(), { timeout: 15 });
                    if (disc?.success) {
                        if (disc.queryId)   graphqlParams.queryId   = disc.queryId;
                        if (disc.features)  graphqlParams.features  = disc.features;
                        if (disc.variables) graphqlParams.variables = disc.variables;
                        if (graphqlParams.queryId) await saveGraphQLCache('SearchTimeline', graphqlParams);
                    }
                } catch (e) {
                    log.warn(`⚠ 动态发现失败: ${e.message}`);
                }
            }
            if (!graphqlParams.queryId) {
                log.log(`使用 fallback queryId: ${S.FALLBACK_QUERY_ID}`);
            }

            // Phase 3: GraphQL 搜索
            log.log('[Phase 3] 使用 GraphQL API 搜索...');
            graphqlFailed = false;
            let cursor = null;
            let cacheInvalidated = false;
            let consecutive429Count = 0;

            for (let page = 1; page <= opts.maxPages; page++) {
                log.log(`正在获取第 ${page}/${opts.maxPages} 页...`);
                const startTime = Date.now();

                const graphqlResult = await retryWithBackoff(
                    async () => safeExecuteScript(tabId, S.buildGraphQLSearchScript(fullQuery, product, cursor, graphqlParams), { timeout: 30 }),
                    { maxRetries: 3, baseDelay: 2000, onRetry: (a, d, r) => log.log(`  重试 #${a}（等待 ${Math.round(d / 1000)}s）: ${r?.error || r?.message || '未知'}`) }
                );
                const elapsed = Date.now() - startTime;

                if (!graphqlResult || !graphqlResult.success) {
                    const statusCode = graphqlResult?.statusCode;

                    if ((statusCode === 400 || statusCode === 404) && !cacheInvalidated) {
                        cacheInvalidated = true;
                        const failedQid = graphqlParams.queryId;
                        log.warn(`⚠ API 返回 ${statusCode}，清除缓存并重新发现...`);
                        await clearGraphQLCache('SearchTimeline');
                        try {
                            let re = await safeExecuteScript(tabId, S.buildDiscoverGraphQLParamsScript(), { timeout: 15 });
                            if (re?.success && re.queryId === failedQid) {
                                await openAndWait(browser, tabId, searchUrl, safeExecuteScript, log);
                                re = await safeExecuteScript(tabId, S.buildDiscoverGraphQLParamsScript(), { timeout: 60 });
                            }
                            if (re?.success && re.queryId) {
                                graphqlParams.queryId   = re.queryId;
                                graphqlParams.features  = re.features  || graphqlParams.features;
                                graphqlParams.variables = re.variables || graphqlParams.variables;
                                await saveGraphQLCache('SearchTimeline', graphqlParams);
                                page--;
                                continue;
                            }
                        } catch (e) { log.warn(`⚠ 重新发现失败: ${e.message}`); }
                    }

                    if (statusCode === 429) {
                        consecutive429Count++;
                        if (consecutive429Count >= 3) {
                            log.log('连续 3 次 429，暂停 5 分钟...');
                            await new Promise(r => setTimeout(r, 5 * 60 * 1000));
                            consecutive429Count = 0;
                            page--;
                            continue;
                        }
                    } else {
                        log.warn(`⚠ GraphQL API 调用失败 (第 ${page} 页): ${graphqlResult?.error || '未知'}`);
                        if (page === 1) graphqlFailed = true;
                        break;
                    }
                }

                if (!graphqlResult || !graphqlResult.success) {
                    if (page === 1) graphqlFailed = true;
                    break;
                } else {
                    consecutive429Count = 0;
                }

                const { tweets: pageTweets, nextCursor } = graphqlResult;
                if (Array.isArray(pageTweets) && pageTweets.length > 0) {
                    let newCount = 0;
                    const newTweets = [];
                    pageTweets.forEach(t => {
                        if (!seenIds.has(t.tweetId)) {
                            seenIds.add(t.tweetId);
                            allTweets.push(t);
                            newTweets.push(t);
                            newCount++;
                        }
                    });
                    log.log(`✓ 第 ${page} 页获取 ${pageTweets.length} 条推文 (${newCount} 条新增)`);
                    if (opts._outputDir) {
                        await appendPartialTweets(opts._outputDir, newTweets);
                    }
                } else {
                    log.log(`第 ${page} 页无更多结果，停止翻页`);
                    break;
                }

                if (nextCursor) { cursor = nextCursor; } else { break; }

                if (page < opts.maxPages) {
                    if (elapsed > 5000)       pageDelay = Math.min(pageDelay * 1.5, MAX_PAGE_DELAY);
                    else                      pageDelay = Math.max(pageDelay * 0.9, MIN_PAGE_DELAY);
                    await new Promise(r => setTimeout(r, pageDelay));
                }
            }
        }

        // Phase 4: DOM 回退
        if (graphqlFailed && allTweets.length === 0) {
            log.log('使用 DOM 提取推文...');
            const domResult = await safeExecuteScript(tabId, S.buildFirstPageScript(), { timeout: 60 });
            if (domResult?.success && domResult.tweets?.length > 0) {
                domResult.tweets.forEach(t => {
                    if (!seenIds.has(t.tweetId)) { seenIds.add(t.tweetId); allTweets.push(t); }
                });
                log.log(`✓ DOM 获取到 ${domResult.tweetCount} 条推文`);
            } else {
                log.warn(`⚠ DOM 也失败: ${domResult?.error || '无推文'}`);
            }
        }

        await releaseXTab(browser, tabId, !opts.closeTab);
        tabId = null;

        // 过滤
        let filteredTweets = allTweets;
        if (opts.minLikes > 0 || opts.minRetweets > 0 || opts.minReplies > 0) {
            filteredTweets = allTweets.filter(t =>
                t.stats.likes    >= opts.minLikes &&
                t.stats.retweets >= opts.minRetweets &&
                t.stats.replies  >= opts.minReplies
            );
        }

        return {
            searchKeyword: keyword,
            searchUrl,
            searchOptions: {
                sort: opts.sort, maxPages: opts.maxPages,
                minLikes: opts.minLikes, minRetweets: opts.minRetweets, minReplies: opts.minReplies,
                lang: opts.lang, from: opts.from, to: opts.to,
                since: opts.since, until: opts.until,
                excludeReplies: opts.excludeReplies, excludeRetweets: opts.excludeRetweets,
                hasLinks: opts.hasLinks,
            },
            timestamp: new Date().toISOString(),
            totalResults: filteredTweets.length,
            results: filteredTweets,
        };
    } catch (err) {
        if (tabId) { try { await releaseXTab(browser, tabId); } catch (_) {} }
        throw err;
    }
}

// ============================================================================
// getProfileTweets
// ============================================================================

/**
 * 获取用户时间线推文
 *
 * @param {import('./js-eyes-client').BrowserAutomation} browser
 * @param {string} username X.com 用户名（不带 @）
 * @param {object} [options]
 * @param {number}  [options.maxPages=50]
 * @param {number}  [options.maxTweets=0]      0 = 不限
 * @param {string}  [options.since]
 * @param {string}  [options.until]
 * @param {boolean} [options.includeReplies=false]
 * @param {boolean} [options.includeRetweets=false]
 * @param {number}  [options.minLikes=0]
 * @param {number}  [options.minRetweets=0]
 * @param {boolean} [options.closeTab=false]
 * @param {object}  [options.logger]
 * @param {string}  [options._outputDir]
 * @returns {Promise<{username,profile,scrapeOptions,timestamp,totalResults,results}>}
 */
async function runGetProfileTweets(browser, username, options = {}) {
    const opts = {
        maxPages: 50, maxTweets: 0,
        since: null, until: null,
        includeReplies: false, includeRetweets: false,
        minLikes: 0, minRetweets: 0,
        closeTab: false,
        ...options,
    };
    const log = makeLog(opts.logger);
    const P = getProfile();
    const profileUrl = `https://x.com/${username}`;
    const safeExecuteScript = createSafeExecuteScript(browser);
    let tabId = null;
    const allTweets = [];
    const seenIds = new Set();
    let userProfile = null;

    let pageDelay = 3000;
    const MIN_PAGE_DELAY = 3000;
    const MAX_PAGE_DELAY = 8000;
    let consecutive429Count = 0;

    try {
        // Phase 1
        log.log('[Phase 1] 获取浏览器标签页...');
        const tabResult = await acquireXTab(browser, profileUrl);
        tabId = tabResult.tabId;
        if (!tabResult.isReused || tabResult.navigated) {
            try { await waitForPageLoad(browser, tabId, { timeout: 30000 }); } catch (_) {}
        }
        const renderWait = tabResult.isReused && !tabResult.navigated ? 1000 : 4000;
        await new Promise(r => setTimeout(r, renderWait));

        // Phase 2: GraphQL 参数发现
        log.log('[Phase 2] 获取 GraphQL 参数...');
        let graphqlParams = {};
        const cacheKey = 'UserProfile';
        const cached = await loadGraphQLCache(cacheKey);
        if (cached && cached.userByScreenNameQueryId && cached.userTweetsQueryId) {
            graphqlParams = cached;
        } else {
            try {
                const disc = await safeExecuteScript(tabId, P.buildDiscoverUserQueryIdsScript(), { timeout: 60 });
                if (disc?.success) {
                    if (disc.userByScreenNameQueryId)      graphqlParams.userByScreenNameQueryId      = disc.userByScreenNameQueryId;
                    if (disc.userTweetsQueryId)             graphqlParams.userTweetsQueryId             = disc.userTweetsQueryId;
                    if (disc.userTweetsAndRepliesQueryId)   graphqlParams.userTweetsAndRepliesQueryId   = disc.userTweetsAndRepliesQueryId;
                    if (disc.features)                      graphqlParams.features                      = disc.features;
                    if (graphqlParams.userByScreenNameQueryId && graphqlParams.userTweetsQueryId) {
                        await saveGraphQLCache(cacheKey, graphqlParams);
                    }
                }
            } catch (e) {
                log.warn(`⚠ 动态发现失败: ${e.message}`);
            }
        }

        if (!graphqlParams.userByScreenNameQueryId) {
            throw new Error('无法发现 UserByScreenName queryId，请确保已登录 X.com');
        }

        // Phase 3: 获取用户信息
        log.log('[Phase 3] 获取用户信息...');
        const userInfoResult = await retryWithBackoff(
            async () => safeExecuteScript(tabId, P.buildUserByScreenNameScript(username, graphqlParams.userByScreenNameQueryId, graphqlParams.features), { timeout: 60 }),
            { maxRetries: 3, baseDelay: 2000 }
        );
        if (!userInfoResult || !userInfoResult.success) {
            throw new Error(`获取用户信息失败: ${userInfoResult?.error || '未知错误'}`);
        }
        const userId = userInfoResult.userId;
        userProfile = userInfoResult.profile;
        log.log(`✓ 用户: ${userProfile.name} (@${userProfile.screenName}) | 推文: ${userProfile.tweetCount}`);

        // Phase 4: UserTweets 翻页
        let tweetsQueryId = opts.includeReplies
            ? (graphqlParams.userTweetsAndRepliesQueryId || graphqlParams.userTweetsQueryId)
            : graphqlParams.userTweetsQueryId;
        if (!tweetsQueryId) throw new Error('无法发现 UserTweets queryId');

        log.log('[Phase 4] 获取推文...');
        let graphqlFailed = false;
        let cursor = null;
        let hitSinceLimit = false;
        let cacheInvalidated = false;

        for (let page = 1; page <= opts.maxPages; page++) {
            log.log(`正在获取第 ${page}/${opts.maxPages} 页...`);
            const startTime = Date.now();

            const graphqlResult = await retryWithBackoff(
                async () => safeExecuteScript(tabId, P.buildUserTweetsScript(userId, cursor, tweetsQueryId, graphqlParams.features, opts.includeReplies), { timeout: 30 }),
                { maxRetries: 3, baseDelay: 3000, maxDelay: 30000 }
            );
            const elapsed = Date.now() - startTime;

            if (!graphqlResult || !graphqlResult.success) {
                const statusCode = graphqlResult?.statusCode;
                if (statusCode === 400 && !cacheInvalidated) {
                    cacheInvalidated = true;
                    await clearGraphQLCache(cacheKey);
                    try {
                        const re = await safeExecuteScript(tabId, P.buildDiscoverUserQueryIdsScript(), { timeout: 60 });
                        if (re?.success) {
                            const newQid = opts.includeReplies
                                ? (re.userTweetsAndRepliesQueryId || re.userTweetsQueryId)
                                : re.userTweetsQueryId;
                            if (newQid) {
                                graphqlParams.userTweetsQueryId = re.userTweetsQueryId || graphqlParams.userTweetsQueryId;
                                graphqlParams.userTweetsAndRepliesQueryId = re.userTweetsAndRepliesQueryId || graphqlParams.userTweetsAndRepliesQueryId;
                                graphqlParams.features = re.features || graphqlParams.features;
                                tweetsQueryId = newQid;
                                await saveGraphQLCache(cacheKey, graphqlParams);
                                page--; continue;
                            }
                        }
                    } catch (e) { log.warn(`⚠ 重新发现失败: ${e.message}`); }
                }
                if (statusCode === 429) {
                    consecutive429Count++;
                    if (consecutive429Count >= 3) {
                        await new Promise(r => setTimeout(r, 5 * 60 * 1000));
                        consecutive429Count = 0;
                        page--; continue;
                    }
                } else {
                    if (page === 1) graphqlFailed = true;
                    break;
                }
            }
            if (!graphqlResult || !graphqlResult.success) { if (page === 1) graphqlFailed = true; break; }
            consecutive429Count = 0;

            const { tweets: pageTweets, nextCursor } = graphqlResult;
            if (Array.isArray(pageTweets) && pageTweets.length > 0) {
                const { filtered, hitSinceLimit: hit } = P.filterTweets(pageTweets, opts);
                hitSinceLimit = hit;
                let newCount = 0;
                const newTweets = [];
                filtered.forEach(t => {
                    if (!seenIds.has(t.tweetId)) { seenIds.add(t.tweetId); allTweets.push(t); newTweets.push(t); newCount++; }
                });
                log.log(`✓ 第 ${page} 页: ${pageTweets.length} 条, ${newCount} 条新增, 累计 ${allTweets.length}`);
                if (opts._outputDir) await appendPartialTweets(opts._outputDir, newTweets);
                if (hitSinceLimit) break;
                if (opts.maxTweets > 0 && allTweets.length >= opts.maxTweets) break;
            } else { break; }

            if (nextCursor) { cursor = nextCursor; } else { break; }
            if (page < opts.maxPages) {
                if (elapsed > 8000) pageDelay = Math.min(pageDelay * 1.5, MAX_PAGE_DELAY);
                else if (elapsed < 3000) pageDelay = Math.max(pageDelay * 0.9, MIN_PAGE_DELAY);
                await new Promise(r => setTimeout(r, pageDelay));
            }
        }

        // Phase 5: DOM 回退
        if (graphqlFailed && allTweets.length === 0) {
            log.log('回退到 DOM 提取...');
            const dom = await safeExecuteScript(tabId, P.buildProfileDomScript(), { timeout: 60 });
            if (dom?.success && dom.tweets?.length > 0) {
                const { filtered } = P.filterTweets(dom.tweets, opts);
                filtered.forEach(t => { if (!seenIds.has(t.tweetId)) { seenIds.add(t.tweetId); allTweets.push(t); } });
            }
        }

        await releaseXTab(browser, tabId, !opts.closeTab);
        tabId = null;

        let filteredTweets = allTweets;
        if (opts.minLikes > 0 || opts.minRetweets > 0) {
            filteredTweets = allTweets.filter(t => t.stats.likes >= opts.minLikes && t.stats.retweets >= opts.minRetweets);
        }
        if (opts.maxTweets > 0 && filteredTweets.length > opts.maxTweets) {
            filteredTweets = filteredTweets.slice(0, opts.maxTweets);
        }

        return {
            username,
            profile: userProfile,
            scrapeOptions: {
                maxPages: opts.maxPages, maxTweets: opts.maxTweets,
                since: opts.since, until: opts.until,
                includeReplies: opts.includeReplies, includeRetweets: opts.includeRetweets,
                minLikes: opts.minLikes, minRetweets: opts.minRetweets,
            },
            timestamp: new Date().toISOString(),
            totalResults: filteredTweets.length,
            results: filteredTweets,
        };
    } catch (err) {
        if (tabId) { try { await releaseXTab(browser, tabId); } catch (_) {} }
        throw err;
    }
}

// ============================================================================
// getPost
// ============================================================================

/**
 * 获取推文详情
 *
 * @param {import('./js-eyes-client').BrowserAutomation} browser
 * @param {string|string[]} tweetInputs 推文 URL 或 ID（单个或数组）
 * @param {object} [options]
 * @param {boolean} [options.withThread=false]
 * @param {number}  [options.withReplies=0]
 * @param {boolean} [options.closeTab=false]
 * @param {object}  [options.logger]
 * @returns {Promise<{scrapeType,scrapeOptions,timestamp,totalRequested,totalSuccess,totalFailed,results}>}
 */
async function runGetPost(browser, tweetInputs, options = {}) {
    const opts = { withThread: false, withReplies: 0, closeTab: false, ...options };
    const log = makeLog(opts.logger);
    const T = getPost_();

    const inputs = Array.isArray(tweetInputs) ? tweetInputs : [tweetInputs];
    const tweetIds = inputs.map(inp => {
        const id = T.extractTweetId(inp);
        if (!id) throw new Error(`无法解析推文 ID: "${inp}"`);
        return id;
    });

    const safeExecuteScript = createSafeExecuteScript(browser);
    let tabId = null;
    const allResults = [];

    try {
        // Phase 1
        log.log('[Phase 1] 获取浏览器标签页...');
        const firstUrl = `https://x.com/i/status/${tweetIds[0]}`;
        const tabResult = await acquireXTab(browser, firstUrl);
        tabId = tabResult.tabId;
        if (!tabResult.isReused || tabResult.navigated) {
            try { await waitForPageLoad(browser, tabId, { timeout: 30000 }); } catch (_) {}
        }
        const renderWait = tabResult.isReused && !tabResult.navigated ? 1000 : 4000;
        await new Promise(r => setTimeout(r, renderWait));

        // Phase 2: GraphQL 参数
        log.log('[Phase 2] 获取 GraphQL 参数...');
        let graphqlParams = {};
        const cacheKey = 'TweetDetail';
        const cached = await loadGraphQLCache(cacheKey);
        if (cached && (cached.tweetDetailQueryId || cached.tweetResultByRestIdQueryId)) {
            graphqlParams = cached;
        } else {
            try {
                const disc = await safeExecuteScript(tabId, T.buildDiscoverTweetQueryIdsScript(), { timeout: 60 });
                if (disc?.success) {
                    if (disc.tweetDetailQueryId)          graphqlParams.tweetDetailQueryId          = disc.tweetDetailQueryId;
                    if (disc.tweetResultByRestIdQueryId)   graphqlParams.tweetResultByRestIdQueryId   = disc.tweetResultByRestIdQueryId;
                    if (disc.features)                     graphqlParams.features                     = disc.features;
                    if (graphqlParams.tweetDetailQueryId || graphqlParams.tweetResultByRestIdQueryId) {
                        await saveGraphQLCache(cacheKey, graphqlParams);
                    }
                }
            } catch (e) { log.warn(`⚠ 动态发现失败: ${e.message}`); }
        }

        const detailQid = graphqlParams.tweetDetailQueryId;
        const restIdQid = graphqlParams.tweetResultByRestIdQueryId;
        if (!detailQid && !restIdQid) {
            throw new Error('无法获取 TweetDetail 或 TweetResultByRestId queryId');
        }

        // Phase 3: 逐条抓取
        log.log(`[Phase 3] 抓取推文 (共 ${tweetIds.length} 条)...`);
        let cacheInvalidated = false;

        for (let i = 0; i < tweetIds.length; i++) {
            const tweetId = tweetIds[i];
            log.log(`抓取第 ${i + 1}/${tweetIds.length} 条: ${tweetId}`);

            let tweetResult = null;
            let graphqlFailed = false;
            const collectReplies = opts.withReplies > 0;

            // 策略 1: TweetDetail
            if (detailQid) {
                tweetResult = await retryWithBackoff(
                    async () => safeExecuteScript(tabId, T.buildTweetDetailScript(tweetId, detailQid, graphqlParams.features, opts.withThread, collectReplies), { timeout: 30 }),
                    { maxRetries: 3, baseDelay: 3000, maxDelay: 30000 }
                );
                if (tweetResult && !tweetResult.success && tweetResult.statusCode === 400 && !cacheInvalidated) {
                    cacheInvalidated = true;
                    await clearGraphQLCache(cacheKey);
                    try {
                        const re = await safeExecuteScript(tabId, T.buildDiscoverTweetQueryIdsScript(), { timeout: 60 });
                        if (re?.success) {
                            if (re.tweetDetailQueryId)        graphqlParams.tweetDetailQueryId        = re.tweetDetailQueryId;
                            if (re.tweetResultByRestIdQueryId) graphqlParams.tweetResultByRestIdQueryId = re.tweetResultByRestIdQueryId;
                            graphqlParams.features = re.features || graphqlParams.features;
                            await saveGraphQLCache(cacheKey, graphqlParams);
                            tweetResult = await safeExecuteScript(tabId, T.buildTweetDetailScript(tweetId, graphqlParams.tweetDetailQueryId || detailQid, graphqlParams.features, opts.withThread, collectReplies), { timeout: 30 });
                        }
                    } catch (_) {}
                }
                if (!tweetResult || !tweetResult.success) graphqlFailed = true;

                // 回复翻页
                if (!graphqlFailed && collectReplies && tweetResult?.replyCursor) {
                    const allReplies = [...(tweetResult.replies || [])];
                    const seenReplyIds = new Set(allReplies.map(r => r.tweetId));
                    let replyCursor = tweetResult.replyCursor;
                    const maxReplyPages = Math.ceil(opts.withReplies / 20) + 1;

                    for (let rp = 1; rp <= maxReplyPages; rp++) {
                        if (allReplies.length >= opts.withReplies || !replyCursor) break;
                        const cur = await retryWithBackoff(
                            async () => safeExecuteScript(tabId, T.buildTweetDetailCursorScript(tweetId, replyCursor, graphqlParams.tweetDetailQueryId || detailQid, graphqlParams.features), { timeout: 30 }),
                            { maxRetries: 2, baseDelay: 3000, maxDelay: 15000 }
                        );
                        if (!cur || !cur.success) break;
                        let newCount = 0;
                        for (const reply of (cur.replies || [])) {
                            if (!seenReplyIds.has(reply.tweetId)) { seenReplyIds.add(reply.tweetId); allReplies.push(reply); newCount++; }
                        }
                        if (newCount === 0) break;
                        replyCursor = cur.nextCursor;
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    tweetResult.replies = allReplies.slice(0, opts.withReplies);
                }
            } else {
                graphqlFailed = true;
            }

            // 策略 2: TweetResultByRestId
            if (graphqlFailed && restIdQid) {
                tweetResult = await retryWithBackoff(
                    async () => safeExecuteScript(tabId, T.buildTweetByRestIdScript(tweetId, restIdQid, graphqlParams.features), { timeout: 30 }),
                    { maxRetries: 3, baseDelay: 3000, maxDelay: 30000 }
                );
                if (!tweetResult || !tweetResult.success) graphqlFailed = true;
                else graphqlFailed = false;
            }

            // 策略 3: DOM 回退
            if (graphqlFailed) {
                const tweetUrl = `https://x.com/i/status/${tweetId}`;
                try { await browser.openUrl(tweetUrl, tabId); await new Promise(r => setTimeout(r, 4000)); } catch (_) {}
                const dom = await safeExecuteScript(tabId, T.buildPostDomScript(tweetId), { timeout: 60 });
                if (dom?.success && dom.focalTweet) { tweetResult = dom; }
                else {
                    allResults.push({ tweetId, error: tweetResult?.error || dom?.error || '抓取失败', success: false });
                    continue;
                }
            }

            if (tweetResult?.success && tweetResult.focalTweet) {
                const postData = { tweetId, success: true, ...tweetResult.focalTweet };
                if (tweetResult.threadTweets?.length > 0) postData.threadTweets = tweetResult.threadTweets;
                if (tweetResult.replies?.length > 0)      postData.replies      = tweetResult.replies;
                allResults.push(postData);
            }

            if (i < tweetIds.length - 1) await new Promise(r => setTimeout(r, 2000));
        }

        await releaseXTab(browser, tabId, !opts.closeTab);
        tabId = null;

        return {
            scrapeType: 'x_post',
            scrapeOptions: { withThread: opts.withThread, withReplies: opts.withReplies },
            timestamp: new Date().toISOString(),
            totalRequested: tweetIds.length,
            totalSuccess: allResults.filter(r => r.success).length,
            totalFailed:  allResults.filter(r => !r.success).length,
            results: allResults,
        };
    } catch (err) {
        if (tabId) { try { await releaseXTab(browser, tabId); } catch (_) {} }
        throw err;
    }
}

// ============================================================================
// getHomeFeed
// ============================================================================

/**
 * 获取首页推荐
 *
 * @param {import('./js-eyes-client').BrowserAutomation} browser
 * @param {object} [options]
 * @param {string}  [options.feed='foryou']    foryou | following
 * @param {number}  [options.maxPages=5]
 * @param {number}  [options.maxTweets=0]
 * @param {number}  [options.minLikes=0]
 * @param {number}  [options.minRetweets=0]
 * @param {boolean} [options.excludeReplies=false]
 * @param {boolean} [options.excludeRetweets=false]
 * @param {boolean} [options.closeTab=false]
 * @param {object}  [options.logger]
 * @param {string}  [options._outputDir]
 * @returns {Promise<{feed,scrapeOptions,timestamp,totalResults,results}>}
 */
async function runGetHomeFeed(browser, options = {}) {
    const opts = {
        feed: 'foryou', maxPages: 5, maxTweets: 0,
        minLikes: 0, minRetweets: 0,
        excludeReplies: false, excludeRetweets: false,
        closeTab: false,
        ...options,
    };
    const log = makeLog(opts.logger);

    const H = getHome();
    const operationName = H.feedToOperationName(opts.feed);
    const cacheKey = H.feedToCacheKey(opts.feed);
    const homeUrl = 'https://x.com/home';

    const safeExecuteScript = createSafeExecuteScript(browser);
    let tabId = null;
    const allTweets = [];
    const seenIds = new Set();

    let pageDelay = 3000;
    const MIN_PAGE_DELAY = 3000;
    const MAX_PAGE_DELAY = 8000;
    let consecutive429Count = 0;

    try {
        // Phase 1
        log.log('[Phase 1] 获取浏览器标签页...');
        const tabResult = await acquireXTab(browser, homeUrl);
        tabId = tabResult.tabId;
        if (!tabResult.isReused || tabResult.navigated) {
            try { await waitForPageLoad(browser, tabId, { timeout: 30000 }); } catch (_) {}
        }
        const renderWait = tabResult.isReused && !tabResult.navigated ? 1000 : 4000;
        await new Promise(r => setTimeout(r, renderWait));

        // Phase 2: GraphQL 参数
        log.log('[Phase 2] 获取 GraphQL 参数...');
        let graphqlParams = {};
        const cached = await loadGraphQLCache(cacheKey);
        if (cached && cached.queryId) {
            graphqlParams = cached;
        } else {
            try {
                const disc = await safeExecuteScript(tabId, H.buildDiscoverHomeQueryIdsScript(), { timeout: 60 });
                if (disc?.success) {
                    if (disc.homeTimelineQueryId)       graphqlParams.homeTimelineQueryId       = disc.homeTimelineQueryId;
                    if (disc.homeLatestTimelineQueryId)  graphqlParams.homeLatestTimelineQueryId  = disc.homeLatestTimelineQueryId;
                    if (disc.features)                   graphqlParams.features                   = disc.features;
                    if (disc.variables)                  graphqlParams.variables                  = disc.variables;
                    graphqlParams.queryId = opts.feed === 'following'
                        ? (graphqlParams.homeLatestTimelineQueryId || graphqlParams.homeTimelineQueryId)
                        : (graphqlParams.homeTimelineQueryId || graphqlParams.homeLatestTimelineQueryId);
                    if (graphqlParams.queryId) await saveGraphQLCache(cacheKey, graphqlParams);
                }
            } catch (e) { log.warn(`⚠ 动态发现失败: ${e.message}`); }
        }

        const queryId = graphqlParams.queryId
            || (opts.feed === 'following' ? graphqlParams.homeLatestTimelineQueryId : graphqlParams.homeTimelineQueryId)
            || graphqlParams.homeTimelineQueryId;
        if (!queryId) throw new Error('无法获取 HomeTimeline queryId');

        // Phase 3: 翻页
        log.log(`[Phase 3] 使用 ${operationName} API 翻页...`);
        let graphqlFailed = false;
        let cursor = null;
        let cacheInvalidated = false;

        for (let page = 1; page <= opts.maxPages; page++) {
            log.log(`正在获取第 ${page}/${opts.maxPages} 页...`);
            const startTime = Date.now();

            const graphqlResult = await retryWithBackoff(
                async () => safeExecuteScript(tabId, H.buildHomeTimelineScript(cursor, queryId, graphqlParams.features, operationName, graphqlParams.variables), { timeout: 30 }),
                { maxRetries: 3, baseDelay: 3000, maxDelay: 30000 }
            );
            const elapsed = Date.now() - startTime;

            if (!graphqlResult || !graphqlResult.success) {
                const statusCode = graphqlResult?.statusCode;
                if (statusCode === 400 && !cacheInvalidated) {
                    cacheInvalidated = true;
                    await clearGraphQLCache(cacheKey);
                    try {
                        const re = await safeExecuteScript(tabId, H.buildDiscoverHomeQueryIdsScript(), { timeout: 60 });
                        if (re?.success) {
                            const newQid = opts.feed === 'following'
                                ? (re.homeLatestTimelineQueryId || re.homeTimelineQueryId)
                                : (re.homeTimelineQueryId || re.homeLatestTimelineQueryId);
                            if (newQid) {
                                graphqlParams.queryId = newQid;
                                graphqlParams.features = re.features || graphqlParams.features;
                                graphqlParams.variables = re.variables || graphqlParams.variables;
                                await saveGraphQLCache(cacheKey, graphqlParams);
                                page--; continue;
                            }
                        }
                    } catch (e) { log.warn(`⚠ 重新发现失败: ${e.message}`); }
                }
                if (statusCode === 429) {
                    consecutive429Count++;
                    if (consecutive429Count >= 3) {
                        await new Promise(r => setTimeout(r, 5 * 60 * 1000));
                        consecutive429Count = 0;
                        page--; continue;
                    }
                } else {
                    if (page === 1) graphqlFailed = true;
                    break;
                }
            }
            if (!graphqlResult || !graphqlResult.success) { if (page === 1) graphqlFailed = true; break; }
            consecutive429Count = 0;

            const { tweets: pageTweets, nextCursor } = graphqlResult;
            if (Array.isArray(pageTweets) && pageTweets.length > 0) {
                const filtered = H.filterTweets(pageTweets, opts);
                let newCount = 0;
                const newTweets = [];
                filtered.forEach(t => {
                    if (!seenIds.has(t.tweetId)) { seenIds.add(t.tweetId); allTweets.push(t); newTweets.push(t); newCount++; }
                });
                log.log(`✓ 第 ${page} 页: ${pageTweets.length} 条, ${newCount} 条新增, 累计 ${allTweets.length}`);
                if (opts._outputDir) await appendPartialTweets(opts._outputDir, newTweets);
                if (opts.maxTweets > 0 && allTweets.length >= opts.maxTweets) break;
            } else { break; }

            if (nextCursor) { cursor = nextCursor; } else { break; }
            if (page < opts.maxPages) {
                if (elapsed > 8000) pageDelay = Math.min(pageDelay * 1.5, MAX_PAGE_DELAY);
                else if (elapsed < 3000) pageDelay = Math.max(pageDelay * 0.9, MIN_PAGE_DELAY);
                await new Promise(r => setTimeout(r, pageDelay));
            }
        }

        // Phase 4: DOM 回退
        if (graphqlFailed && allTweets.length === 0) {
            log.log('回退到 DOM 提取...');
            const dom = await safeExecuteScript(tabId, H.buildHomeDomScript(), { timeout: 60 });
            if (dom?.success && dom.tweets?.length > 0) {
                const filtered = H.filterTweets(dom.tweets, opts);
                filtered.forEach(t => { if (!seenIds.has(t.tweetId)) { seenIds.add(t.tweetId); allTweets.push(t); } });
            }
        }

        await releaseXTab(browser, tabId, !opts.closeTab);
        tabId = null;

        let filteredTweets = allTweets;
        if (opts.minLikes > 0 || opts.minRetweets > 0) {
            filteredTweets = allTweets.filter(t => t.stats.likes >= opts.minLikes && t.stats.retweets >= opts.minRetweets);
        }
        if (opts.maxTweets > 0 && filteredTweets.length > opts.maxTweets) {
            filteredTweets = filteredTweets.slice(0, opts.maxTweets);
        }

        return {
            feed: opts.feed,
            scrapeOptions: {
                feed: opts.feed, maxPages: opts.maxPages, maxTweets: opts.maxTweets,
                minLikes: opts.minLikes, minRetweets: opts.minRetweets,
                excludeReplies: opts.excludeReplies, excludeRetweets: opts.excludeRetweets,
            },
            timestamp: new Date().toISOString(),
            totalResults: filteredTweets.length,
            results: filteredTweets,
        };
    } catch (err) {
        if (tabId) { try { await releaseXTab(browser, tabId); } catch (_) {} }
        throw err;
    }
}

function _disabledByOptions(options) {
    return process.env.JS_X_DISABLE_BRIDGE === '1' || (options && options.useBridge === false);
}

function _disabledMessage(options) {
    if (process.env.JS_X_DISABLE_BRIDGE === '1') return 'JS_X_DISABLE_BRIDGE=1';
    if (options && options.useBridge === false) return 'options.useBridge=false';
    return null;
}

async function _profileWithBridgeOrFallback(browser, username, options) {
    const log = makeLog(options.logger);
    const useBridge = _shouldUseBridge(options);
    if (!useBridge) {
        const result = await runGetProfileTweets(browser, username, options);
        return _attachBridgeMetrics(result, {
            bridgeUsed: false,
            bridgeFallback: _disabledByOptions(options),
            bridgeFallbackReason: _disabledByOptions(options) ? FALLBACK_REASON.DISABLED_BY_ENV : null,
            bridgeFallbackMessage: _disabledMessage(options),
        });
    }
    try {
        const result = await profileViaBridge(browser, username, options);
        const route = result._bridge || {};
        delete result._bridge;
        return _attachBridgeMetrics(result, {
            bridgeUsed: true,
            bridgeFallback: false,
            bridgeTarget: route.target || null,
            bridgeVersion: route.bridge && route.bridge.version || null,
            bridgeMeta: route.meta || null,
        });
    } catch (bridgeError) {
        log.warn(`⚠ bridge profile 失败，回退老路径: ${bridgeError.message}`);
        if (!_shouldFallback()) throw bridgeError;
        const fallback = await runGetProfileTweets(browser, username, options);
        return _attachBridgeMetrics(fallback, {
            bridgeUsed: false,
            bridgeFallback: true,
            bridgeFallbackReason: classifyBridgeError(bridgeError),
            bridgeFallbackMessage: bridgeError.message || String(bridgeError),
            bridgeFallbackCode: bridgeError.code || null,
        });
    }
}

async function _homeWithBridgeOrFallback(browser, options) {
    const log = makeLog(options.logger);
    const useBridge = _shouldUseBridge(options);
    if (!useBridge) {
        const result = await runGetHomeFeed(browser, options);
        return _attachBridgeMetrics(result, {
            bridgeUsed: false,
            bridgeFallback: _disabledByOptions(options),
            bridgeFallbackReason: _disabledByOptions(options) ? FALLBACK_REASON.DISABLED_BY_ENV : null,
            bridgeFallbackMessage: _disabledMessage(options),
        });
    }
    try {
        const result = await homeViaBridge(browser, options);
        const route = result._bridge || {};
        delete result._bridge;
        return _attachBridgeMetrics(result, {
            bridgeUsed: true,
            bridgeFallback: false,
            bridgeTarget: route.target || null,
            bridgeVersion: route.bridge && route.bridge.version || null,
            bridgeMeta: route.meta || null,
        });
    } catch (bridgeError) {
        log.warn(`⚠ bridge home 失败，回退老路径: ${bridgeError.message}`);
        if (!_shouldFallback()) throw bridgeError;
        const fallback = await runGetHomeFeed(browser, options);
        return _attachBridgeMetrics(fallback, {
            bridgeUsed: false,
            bridgeFallback: true,
            bridgeFallbackReason: classifyBridgeError(bridgeError),
            bridgeFallbackMessage: bridgeError.message || String(bridgeError),
            bridgeFallbackCode: bridgeError.code || null,
        });
    }
}

function _hasWriteParams(options) {
    if (!options) return false;
    return !!(options.post || options.reply || options.quote || options.thread || options.media);
}

async function _postWithBridgeOrFallback(browser, tweetInputs, options) {
    const log = makeLog(options.logger);
    if (_hasWriteParams(options)) {
        return await runGetPost(browser, tweetInputs, options);
    }
    const useBridge = _shouldUseBridge(options);
    if (!useBridge) {
        const result = await runGetPost(browser, tweetInputs, options);
        return _attachBridgeMetrics(result, {
            bridgeUsed: false,
            bridgeFallback: _disabledByOptions(options),
            bridgeFallbackReason: _disabledByOptions(options) ? FALLBACK_REASON.DISABLED_BY_ENV : null,
            bridgeFallbackMessage: _disabledMessage(options),
        });
    }
    try {
        const result = await postViaBridge(browser, tweetInputs, options);
        const route = result._bridge || {};
        delete result._bridge;
        return _attachBridgeMetrics(result, {
            bridgeUsed: true,
            bridgeFallback: false,
            bridgeTarget: route.target || null,
            bridgeVersion: route.bridge && route.bridge.version || null,
            bridgeMeta: route.meta || null,
        });
    } catch (bridgeError) {
        log.warn(`⚠ bridge post 失败，回退老路径: ${bridgeError.message}`);
        if (!_shouldFallback()) throw bridgeError;
        const fallback = await runGetPost(browser, tweetInputs, options);
        return _attachBridgeMetrics(fallback, {
            bridgeUsed: false,
            bridgeFallback: true,
            bridgeFallbackReason: classifyBridgeError(bridgeError),
            bridgeFallbackMessage: bridgeError.message || String(bridgeError),
            bridgeFallbackCode: bridgeError.code || null,
        });
    }
}

async function _searchWithBridgeOrFallback(browser, keyword, options) {
    const log = makeLog(options.logger);
    const useBridge = _shouldUseBridge(options);
    if (!useBridge) {
        const result = await runSearchTweets(browser, keyword, options);
        return _attachBridgeMetrics(result, {
            bridgeUsed: false,
            bridgeFallback: process.env.JS_X_DISABLE_BRIDGE === '1' || options.useBridge === false,
            bridgeFallbackReason: process.env.JS_X_DISABLE_BRIDGE === '1' || options.useBridge === false
                ? FALLBACK_REASON.DISABLED_BY_ENV : null,
            bridgeFallbackMessage: process.env.JS_X_DISABLE_BRIDGE === '1'
                ? 'JS_X_DISABLE_BRIDGE=1' : (options.useBridge === false ? 'options.useBridge=false' : null),
        });
    }
    try {
        const result = await searchViaBridge(browser, keyword, options);
        const route = result._bridge || {};
        delete result._bridge;
        return _attachBridgeMetrics(result, {
            bridgeUsed: true,
            bridgeFallback: false,
            bridgeTarget: route.target || null,
            bridgeVersion: route.bridge && route.bridge.version || null,
            bridgeMeta: route.meta || null,
        });
    } catch (bridgeError) {
        log.warn(`⚠ bridge search 失败，回退老路径: ${bridgeError.message}`);
        if (!_shouldFallback()) throw bridgeError;
        const fallback = await runSearchTweets(browser, keyword, options);
        return _attachBridgeMetrics(fallback, {
            bridgeUsed: false,
            bridgeFallback: true,
            bridgeFallbackReason: classifyBridgeError(bridgeError),
            bridgeFallbackMessage: bridgeError.message || String(bridgeError),
            bridgeFallbackCode: bridgeError.code || null,
        });
    }
}

async function searchTweets(browser, keyword, options = {}) {
    const runContext = createXRunContext('x_search', {
        keyword,
        maxPages: options.maxPages || 1,
        sort: options.sort || 'top',
        minLikes: options.minLikes || 0,
        minRetweets: options.minRetweets || 0,
        minReplies: options.minReplies || 0,
        lang: options.lang || null,
        from: options.from || null,
        to: options.to || null,
        since: options.since || null,
        until: options.until || null,
        excludeReplies: options.excludeReplies === true,
        excludeRetweets: options.excludeRetweets === true,
        hasLinks: options.hasLinks === true,
    }, options);
    const startedAtMs = Date.now();
    const cached = readCacheEntry(runContext, 'search');
    const cachedResponse = attachXCacheHit(runContext, cached, startedAtMs);
    if (cachedResponse) {
        return cachedResponse;
    }

    const debugState = createDebugState();
    const logger = createRecordingLogger(options.logger, debugState);
    let response = null;
    let debugBundlePath = '';

    try {
        const result = await _searchWithBridgeOrFallback(browser, keyword, { ...options, logger });
        recordDomStat(debugState, 'result_summary', { totalResults: result.totalResults || 0 });
        response = buildXResponse(runContext, result, Date.now() - startedAtMs, { hit: false });
        const cacheEntry = writeCacheEntry(runContext, { response }, 'search');
        if (cacheEntry) {
            response.cache.createdAt = cacheEntry.createdAt;
            response.cache.expiresAt = cacheEntry.expiresAt;
        }
        if (runContext.recording.debugEnabled) {
            debugBundlePath = writeDebugBundle(runContext, {
                meta: {
                    runId: runContext.runId,
                    skillId: runContext.skillId,
                    scrapeType: runContext.scrapeType,
                    input: runContext.normalizedInput,
                    recordingMode: runContext.recording.mode,
                    cacheKey: runContext.cacheKey,
                    metrics: response.metrics,
                },
                steps: debugState.steps,
                domStats: debugState.domStats,
                result: response,
            }) || '';
            response.debug = { bundlePath: debugBundlePath };
        }
        appendHistory(runContext, buildXHistoryEntry(runContext, response, {
            durationMs: response.metrics.durationMs,
            cacheHit: false,
            debugBundlePath,
        }));
        return response;
    } catch (error) {
        if (runContext.recording.debugEnabled) {
            debugBundlePath = writeDebugBundle(runContext, {
                meta: {
                    runId: runContext.runId,
                    skillId: runContext.skillId,
                    scrapeType: runContext.scrapeType,
                    input: runContext.normalizedInput,
                    recordingMode: runContext.recording.mode,
                    cacheKey: runContext.cacheKey,
                    error: error.message,
                },
                steps: debugState.steps,
                domStats: debugState.domStats,
                result: { error: error.message },
            }) || '';
        }
        appendHistory(runContext, buildXHistoryEntry(runContext, response, {
            status: 'failed',
            durationMs: Date.now() - startedAtMs,
            cacheHit: false,
            debugBundlePath,
            errorSummary: error.message,
        }));
        throw error;
    }
}

async function getProfileTweets(browser, username, options = {}) {
    const runContext = createXRunContext('x_profile', {
        username,
        maxPages: options.maxPages || 50,
        maxTweets: options.maxTweets || 0,
        since: options.since || null,
        until: options.until || null,
        includeReplies: options.includeReplies === true,
        includeRetweets: options.includeRetweets === true,
        minLikes: options.minLikes || 0,
        minRetweets: options.minRetweets || 0,
    }, options);
    const startedAtMs = Date.now();
    const cached = readCacheEntry(runContext, 'profile');
    const cachedResponse = attachXCacheHit(runContext, cached, startedAtMs);
    if (cachedResponse) {
        return cachedResponse;
    }

    const debugState = createDebugState();
    const logger = createRecordingLogger(options.logger, debugState);
    let response = null;
    let debugBundlePath = '';

    try {
        const result = await _profileWithBridgeOrFallback(browser, username, { ...options, logger });
        recordDomStat(debugState, 'result_summary', { totalResults: result.totalResults || 0 });
        response = buildXResponse(runContext, result, Date.now() - startedAtMs, { hit: false });
        const cacheEntry = writeCacheEntry(runContext, { response }, 'profile');
        if (cacheEntry) {
            response.cache.createdAt = cacheEntry.createdAt;
            response.cache.expiresAt = cacheEntry.expiresAt;
        }
        if (runContext.recording.debugEnabled) {
            debugBundlePath = writeDebugBundle(runContext, {
                meta: {
                    runId: runContext.runId,
                    skillId: runContext.skillId,
                    scrapeType: runContext.scrapeType,
                    input: runContext.normalizedInput,
                    recordingMode: runContext.recording.mode,
                    cacheKey: runContext.cacheKey,
                    metrics: response.metrics,
                },
                steps: debugState.steps,
                domStats: debugState.domStats,
                result: response,
            }) || '';
            response.debug = { bundlePath: debugBundlePath };
        }
        appendHistory(runContext, buildXHistoryEntry(runContext, response, {
            durationMs: response.metrics.durationMs,
            cacheHit: false,
            debugBundlePath,
        }));
        return response;
    } catch (error) {
        if (runContext.recording.debugEnabled) {
            debugBundlePath = writeDebugBundle(runContext, {
                meta: {
                    runId: runContext.runId,
                    skillId: runContext.skillId,
                    scrapeType: runContext.scrapeType,
                    input: runContext.normalizedInput,
                    recordingMode: runContext.recording.mode,
                    cacheKey: runContext.cacheKey,
                    error: error.message,
                },
                steps: debugState.steps,
                domStats: debugState.domStats,
                result: { error: error.message },
            }) || '';
        }
        appendHistory(runContext, buildXHistoryEntry(runContext, response, {
            status: 'failed',
            durationMs: Date.now() - startedAtMs,
            cacheHit: false,
            debugBundlePath,
            errorSummary: error.message,
        }));
        throw error;
    }
}

async function getPost(browser, tweetInputs, options = {}) {
    const runContext = createXRunContext('x_post', {
        tweetInputs: Array.isArray(tweetInputs) ? tweetInputs : [tweetInputs],
        withThread: options.withThread === true,
        withReplies: options.withReplies || 0,
    }, options);
    const startedAtMs = Date.now();
    const cached = readCacheEntry(runContext, 'post');
    const cachedResponse = attachXCacheHit(runContext, cached, startedAtMs);
    if (cachedResponse) {
        return cachedResponse;
    }

    const debugState = createDebugState();
    const logger = createRecordingLogger(options.logger, debugState);
    let response = null;
    let debugBundlePath = '';

    try {
        const result = await _postWithBridgeOrFallback(browser, tweetInputs, { ...options, logger });
        recordDomStat(debugState, 'result_summary', {
            totalRequested: result.totalRequested || 0,
            totalSuccess: result.totalSuccess || 0,
            totalFailed: result.totalFailed || 0,
        });
        response = buildXResponse(runContext, result, Date.now() - startedAtMs, { hit: false });
        const cacheEntry = writeCacheEntry(runContext, { response }, 'post');
        if (cacheEntry) {
            response.cache.createdAt = cacheEntry.createdAt;
            response.cache.expiresAt = cacheEntry.expiresAt;
        }
        if (runContext.recording.debugEnabled) {
            debugBundlePath = writeDebugBundle(runContext, {
                meta: {
                    runId: runContext.runId,
                    skillId: runContext.skillId,
                    scrapeType: runContext.scrapeType,
                    input: runContext.normalizedInput,
                    recordingMode: runContext.recording.mode,
                    cacheKey: runContext.cacheKey,
                    metrics: response.metrics,
                },
                steps: debugState.steps,
                domStats: debugState.domStats,
                result: response,
            }) || '';
            response.debug = { bundlePath: debugBundlePath };
        }
        appendHistory(runContext, buildXHistoryEntry(runContext, response, {
            durationMs: response.metrics.durationMs,
            cacheHit: false,
            debugBundlePath,
        }));
        return response;
    } catch (error) {
        if (runContext.recording.debugEnabled) {
            debugBundlePath = writeDebugBundle(runContext, {
                meta: {
                    runId: runContext.runId,
                    skillId: runContext.skillId,
                    scrapeType: runContext.scrapeType,
                    input: runContext.normalizedInput,
                    recordingMode: runContext.recording.mode,
                    cacheKey: runContext.cacheKey,
                    error: error.message,
                },
                steps: debugState.steps,
                domStats: debugState.domStats,
                result: { error: error.message },
            }) || '';
        }
        appendHistory(runContext, buildXHistoryEntry(runContext, response, {
            status: 'failed',
            durationMs: Date.now() - startedAtMs,
            cacheHit: false,
            debugBundlePath,
            errorSummary: error.message,
        }));
        throw error;
    }
}

async function getHomeFeed(browser, options = {}) {
    const runContext = createXRunContext('x_home', {
        feed: options.feed || 'foryou',
        maxPages: options.maxPages || 5,
        maxTweets: options.maxTweets || 0,
        minLikes: options.minLikes || 0,
        minRetweets: options.minRetweets || 0,
        excludeReplies: options.excludeReplies === true,
        excludeRetweets: options.excludeRetweets === true,
    }, options);
    const startedAtMs = Date.now();
    const cached = readCacheEntry(runContext, 'home');
    const cachedResponse = attachXCacheHit(runContext, cached, startedAtMs);
    if (cachedResponse) {
        return cachedResponse;
    }

    const debugState = createDebugState();
    const logger = createRecordingLogger(options.logger, debugState);
    let response = null;
    let debugBundlePath = '';

    try {
        const result = await _homeWithBridgeOrFallback(browser, { ...options, logger });
        recordDomStat(debugState, 'result_summary', { totalResults: result.totalResults || 0, feed: result.feed });
        response = buildXResponse(runContext, result, Date.now() - startedAtMs, { hit: false });
        const cacheEntry = writeCacheEntry(runContext, { response }, 'home');
        if (cacheEntry) {
            response.cache.createdAt = cacheEntry.createdAt;
            response.cache.expiresAt = cacheEntry.expiresAt;
        }
        if (runContext.recording.debugEnabled) {
            debugBundlePath = writeDebugBundle(runContext, {
                meta: {
                    runId: runContext.runId,
                    skillId: runContext.skillId,
                    scrapeType: runContext.scrapeType,
                    input: runContext.normalizedInput,
                    recordingMode: runContext.recording.mode,
                    cacheKey: runContext.cacheKey,
                    metrics: response.metrics,
                },
                steps: debugState.steps,
                domStats: debugState.domStats,
                result: response,
            }) || '';
            response.debug = { bundlePath: debugBundlePath };
        }
        appendHistory(runContext, buildXHistoryEntry(runContext, response, {
            durationMs: response.metrics.durationMs,
            cacheHit: false,
            debugBundlePath,
        }));
        return response;
    } catch (error) {
        if (runContext.recording.debugEnabled) {
            debugBundlePath = writeDebugBundle(runContext, {
                meta: {
                    runId: runContext.runId,
                    skillId: runContext.skillId,
                    scrapeType: runContext.scrapeType,
                    input: runContext.normalizedInput,
                    recordingMode: runContext.recording.mode,
                    cacheKey: runContext.cacheKey,
                    error: error.message,
                },
                steps: debugState.steps,
                domStats: debugState.domStats,
                result: { error: error.message },
            }) || '';
        }
        appendHistory(runContext, buildXHistoryEntry(runContext, response, {
            status: 'failed',
            durationMs: Date.now() - startedAtMs,
            cacheHit: false,
            debugBundlePath,
            errorSummary: error.message,
        }));
        throw error;
    }
}

module.exports = { searchTweets, getProfileTweets, getPost, getHomeFeed };
