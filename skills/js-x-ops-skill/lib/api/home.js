'use strict';

function createMethods(dependencies = {}) {
  const { acquireXTab, appendPartialTweets, clearGraphQLCache, createSafeExecuteScript, getHome, loadGraphQLCache, makeLog, releaseXTab, retryWithBackoff, saveGraphQLCache, waitForPageLoad } = dependencies;

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

  return {
    runGetHomeFeed,
  };
}

module.exports = { createMethods };
