'use strict';

function createMethods(dependencies = {}) {
  const { _homeWithBridgeOrFallback, _postWithBridgeOrFallback, _profileWithBridgeOrFallback, _searchWithBridgeOrFallback, appendHistory, attachPostMediaDownloads, attachXCacheHit, buildXHistoryEntry, buildXResponse, createDebugState, createRecordingLogger, createXRunContext, readCacheEntry, recordDomStat, writeCacheEntry, writeDebugBundle } = dependencies;

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
        if (options.downloadMedia) {
            await attachPostMediaDownloads(cachedResponse, {
                downloadMedia: true,
                outDir: options.outDir,
                logger: options.logger,
            });
        }
        return cachedResponse;
    }

    const debugState = createDebugState();
    const logger = createRecordingLogger(options.logger, debugState);
    let response = null;
    let debugBundlePath = '';

    try {
        const result = await _postWithBridgeOrFallback(browser, tweetInputs, { ...options, logger });
        if (options.downloadMedia) {
            await attachPostMediaDownloads(result, {
                downloadMedia: true,
                outDir: options.outDir,
                logger,
            });
        }
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

  return {
    searchTweets,
    getProfileTweets,
    getPost,
    getHomeFeed,
  };
}

module.exports = { createMethods };
