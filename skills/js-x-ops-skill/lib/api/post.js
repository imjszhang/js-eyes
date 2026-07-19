'use strict';

function createMethods(dependencies = {}) {
  const { acquireXTab, classifyXPostInput, clearGraphQLCache, createSafeExecuteScript, getPost_, loadGraphQLCache, makeLog, releaseXTab, retryWithBackoff, saveGraphQLCache, waitForPageLoad } = dependencies;

async function runGetPost(browser, tweetInputs, options = {}) {
    const opts = { withThread: false, withReplies: 0, closeTab: false, ...options };
    const log = makeLog(opts.logger);
    const T = getPost_();

    const inputs = Array.isArray(tweetInputs) ? tweetInputs : [tweetInputs];
    const tweetIds = inputs.map(inp => {
        const cls = classifyXPostInput(inp);
        if (cls.kind === 'article' || cls.kind === 'short') {
            throw new Error(`Article/短链 URL 需走 bridge 路径读取: "${inp}"`);
        }
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

  return {
    runGetPost,
  };
}

module.exports = { createMethods };
