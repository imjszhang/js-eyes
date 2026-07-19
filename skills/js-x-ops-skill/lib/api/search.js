'use strict';

function createMethods(dependencies = {}) {
  const { acquireXTab, appendPartialTweets, clearGraphQLCache, createSafeExecuteScript, getSearch, loadGraphQLCache, makeLog, openAndWait, releaseXTab, retryWithBackoff, saveGraphQLCache, waitForPageLoad } = dependencies;

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

  return {
    runSearchTweets,
  };
}

module.exports = { createMethods };
