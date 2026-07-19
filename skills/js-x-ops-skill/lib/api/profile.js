'use strict';

function createMethods(dependencies = {}) {
  const { acquireXTab, appendPartialTweets, clearGraphQLCache, createSafeExecuteScript, getProfile, loadGraphQLCache, makeLog, releaseXTab, retryWithBackoff, saveGraphQLCache, waitForPageLoad } = dependencies;

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

  return {
    runGetProfileTweets,
  };
}

module.exports = { createMethods };
