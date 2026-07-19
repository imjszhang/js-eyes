'use strict';

function createMethods(dependencies = {}) {
  const { READ_CMD_DEF, buildPostBridgeArgs, canonicalNavigateUrl, classifyXPostInput, getHome, getProfile, getSearch, postResultKey, runTool } = dependencies;

function commonRunToolOptions(browser, opts, targetUrl) {
    const o = {
        wsEndpoint: browser && browser.serverUrl,
        recording: opts.recording,
        runId: opts.runId,
        navigateOnReuse: false,
        reuseAnyXTab: true,
        createUrl: targetUrl || 'https://x.com/',
        timeoutMs: opts.bridgeTimeoutMs || 120000,
        readMode: opts.readMode,
    };
    if (opts.visualRecord != null) o.visualRecord = opts.visualRecord;
    if (opts.visualTrace != null) o.visualTrace = opts.visualTrace;
    if (opts.noFrames != null) o.noFrames = opts.noFrames;
    if (opts.hiDpi != null) o.hiDpi = opts.hiDpi;
    if (opts.maxFrames != null) o.maxFrames = opts.maxFrames;
    if (opts.verbose != null) o.verbose = opts.verbose;
    if (opts.visualConfig != null) o.visualConfig = opts.visualConfig;
    return o;
}

function errFromRunTool(rt) {
    const e = new Error(`bridge 失败: ${(rt.error && rt.error.code) || 'unknown'}`);
    e.code = 'BRIDGE_RETURN_NOT_OK';
    e.detail = rt;
    return e;
}

async function searchViaRunTool(browser, keyword, options) {
    const opts = {
        maxPages: 1, sort: 'top',
        minLikes: 0, minRetweets: 0, minReplies: 0,
        lang: null, from: null, to: null, since: null, until: null,
        excludeReplies: false, excludeRetweets: false, hasLinks: false,
        ...options,
    };
    const S = getSearch();
    const searchUrl = S.buildSearchUrl(keyword, opts);
    const args = {
        keyword,
        sort: opts.sort,
        maxPages: opts.maxPages,
        from: opts.from, to: opts.to,
        since: opts.since, until: opts.until,
        lang: opts.lang,
        minLikes: opts.minLikes, minRetweets: opts.minRetweets, minReplies: opts.minReplies,
        excludeReplies: opts.excludeReplies, excludeRetweets: opts.excludeRetweets,
        hasLinks: opts.hasLinks,
    };
    const rt = await runTool(browser, {
        toolName: 'x_search_tweets',
        pageKey: 'search',
        method: 'search',
        cmdDef: READ_CMD_DEF.search,
        args,
        targetUrl: searchUrl,
        options: commonRunToolOptions(browser, opts, searchUrl),
    });
    if (!rt.ok) throw errFromRunTool(rt);
    const data = rt.result || {};
    let results = Array.isArray(data.tweets) ? data.tweets : [];
    if (opts.minLikes > 0 || opts.minRetweets > 0 || opts.minReplies > 0) {
        results = results.filter((t) =>
            (t.stats?.likes || 0) >= opts.minLikes &&
            (t.stats?.retweets || 0) >= opts.minRetweets &&
            (t.stats?.replies || 0) >= opts.minReplies,
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
        totalResults: results.length,
        results,
        runToolAudit: {
            readMode: rt.readMode,
            requestedReadMode: rt.requestedReadMode,
            fallback: rt.fallback,
            triedMethods: rt.triedMethods,
            usedMethod: rt.usedMethod,
        },
        _bridge: {
            target: rt.run && rt.run.target,
            bridge: rt.bridge,
            meta: data.meta || null,
            pages: data.pages || [],
            fullQuery: data.fullQuery || null,
        },
    };
}

async function profileViaRunTool(browser, username, options) {
    const opts = {
        maxPages: 50, maxTweets: 0,
        since: null, until: null,
        includeReplies: false, includeRetweets: false,
        minLikes: 0, minRetweets: 0,
        ...options,
    };
    const cleanUsername = String(username || '').replace(/^@/, '').trim();
    if (!cleanUsername) throw new Error('profileViaRunTool: username is required');
    const profileUrl = `https://x.com/${cleanUsername}` + (opts.includeReplies ? '/with_replies' : '');
    const args = {
        username: cleanUsername,
        maxPages: opts.maxPages,
        includeReplies: opts.includeReplies,
    };
    const rt = await runTool(browser, {
        toolName: 'x_get_profile',
        pageKey: 'profile',
        method: 'getProfile',
        cmdDef: READ_CMD_DEF.profile,
        args,
        targetUrl: profileUrl,
        options: commonRunToolOptions(browser, opts, profileUrl),
    });
    if (!rt.ok) throw errFromRunTool(rt);
    const P = getProfile();
    const data = rt.result || {};
    const { enrichProfilePinnedTweet, markPinnedTweets } = require('./profile-enrich');
    const profile = await enrichProfilePinnedTweet(data.profile || null, cleanUsername, opts.logger);
    let rawTweets = Array.isArray(data.tweets) ? data.tweets : [];
    rawTweets = markPinnedTweets(rawTweets, profile?.pinnedTweetId);
    const { filtered } = P.filterTweets(rawTweets, opts);
    let results = filtered;
    if (opts.minLikes > 0 || opts.minRetweets > 0) {
        results = results.filter((t) =>
            (t.stats?.likes || 0) >= opts.minLikes &&
            (t.stats?.retweets || 0) >= opts.minRetweets,
        );
    }
    if (opts.maxTweets > 0 && results.length > opts.maxTweets) {
        results = results.slice(0, opts.maxTweets);
    }
    return {
        username: cleanUsername,
        profile,
        scrapeOptions: {
            maxPages: opts.maxPages, maxTweets: opts.maxTweets,
            since: opts.since, until: opts.until,
            includeReplies: opts.includeReplies, includeRetweets: opts.includeRetweets,
            minLikes: opts.minLikes, minRetweets: opts.minRetweets,
        },
        timestamp: new Date().toISOString(),
        totalResults: results.length,
        results,
        runToolAudit: {
            readMode: rt.readMode,
            requestedReadMode: rt.requestedReadMode,
            fallback: rt.fallback,
            triedMethods: rt.triedMethods,
            usedMethod: rt.usedMethod,
        },
        _bridge: {
            target: rt.run && rt.run.target,
            bridge: rt.bridge,
            meta: data.meta || null,
            pages: data.pages || [],
        },
    };
}

async function homeViaRunTool(browser, options) {
    const opts = {
        feed: 'foryou', maxPages: 5, maxTweets: 0,
        minLikes: 0, minRetweets: 0,
        excludeReplies: false, excludeRetweets: false,
        ...options,
    };
    const args = {
        feed: opts.feed,
        maxPages: opts.maxPages,
    };
    const targetUrl = 'https://x.com/home';
    const rt = await runTool(browser, {
        toolName: 'x_get_home_feed',
        pageKey: 'home',
        method: 'getHome',
        cmdDef: READ_CMD_DEF.home,
        args,
        targetUrl,
        options: commonRunToolOptions(browser, opts, targetUrl),
    });
    if (!rt.ok) throw errFromRunTool(rt);
    const H = getHome();
    const data = rt.result || {};
    let rawTweets = Array.isArray(data.tweets) ? data.tweets : [];
    if (opts.maxTweets > 0 && rawTweets.length > opts.maxTweets) {
        rawTweets = rawTweets.slice(0, opts.maxTweets);
    }
    let results = H.filterTweets(rawTweets, opts);
    if (opts.minLikes > 0 || opts.minRetweets > 0) {
        results = results.filter((t) =>
            (t.stats?.likes || 0) >= opts.minLikes &&
            (t.stats?.retweets || 0) >= opts.minRetweets,
        );
    }
    if (opts.maxTweets > 0 && results.length > opts.maxTweets) {
        results = results.slice(0, opts.maxTweets);
    }
    return {
        feed: data.feed || opts.feed,
        scrapeOptions: {
            feed: opts.feed, maxPages: opts.maxPages, maxTweets: opts.maxTweets,
            minLikes: opts.minLikes, minRetweets: opts.minRetweets,
            excludeReplies: opts.excludeReplies, excludeRetweets: opts.excludeRetweets,
        },
        timestamp: new Date().toISOString(),
        totalResults: results.length,
        results,
        runToolAudit: {
            readMode: rt.readMode,
            requestedReadMode: rt.requestedReadMode,
            fallback: rt.fallback,
            triedMethods: rt.triedMethods,
            usedMethod: rt.usedMethod,
        },
        _bridge: {
            target: rt.run && rt.run.target,
            bridge: rt.bridge,
            meta: data.meta || null,
            pages: data.pages || [],
        },
    };
}

async function postViaRunTool(browser, tweetInputs, options) {
    const opts = { withThread: false, withReplies: 0, ...options };
    const inputs = Array.isArray(tweetInputs) ? tweetInputs : [tweetInputs];
    const classifications = inputs.map((inp) => {
        const cls = classifyXPostInput(inp);
        if (cls.kind === 'unknown') {
            throw new Error(`无法解析帖子 URL 或 ID: "${inp}"`);
        }
        return cls;
    });
    let lastTarget = null;
    let lastBridge = null;
    const allResults = [];

    for (let i = 0; i < classifications.length; i++) {
        const cls = classifications[i];
        const rawInput = inputs[i];
        const rawStr = String(rawInput || '').trim();
        const bridgeArgs = buildPostBridgeArgs(cls, opts);
        const targetUrl = canonicalNavigateUrl(cls, rawStr) || 'https://x.com/';
        const resultId = cls.kind === 'article' ? cls.articleId : cls.tweetId;

        const dispatch = postRunToolDispatch(cls);
        const rt = await runTool(browser, {
            toolName: 'x_get_post',
            pageKey: 'post',
            method: dispatch.method,
            cmdDef: dispatch.cmdDef,
            args: bridgeArgs,
            targetUrl,
            options: commonRunToolOptions(browser, opts, targetUrl),
        });
        lastTarget = rt.run && rt.run.target;
        lastBridge = rt.bridge;

        if (!rt.ok) {
            allResults.push({
                [postResultKey(cls)]: resultId,
                contentKind: cls.kind,
                success: false,
                error: (rt.error && rt.error.code) || 'runTool_failed',
            });
        } else {
            const data = rt.result || {};
            if (data.contentKind === 'article' && data.article) {
                const postData = {
                    contentKind: 'article',
                    articleId: data.articleId || cls.articleId,
                    success: true,
                    ...data.article,
                };
                if (data.seedTweet) postData.seedTweet = data.seedTweet;
                if (data.meta) {
                    if (data.meta.autoResolvedFromTweet) postData.autoResolvedFromTweet = true;
                    if (data.meta.seedTweetId) postData.seedTweetId = data.meta.seedTweetId;
                }
                allResults.push(postData);
            } else if (data.tweet) {
                const postData = {
                    contentKind: 'tweet',
                    tweetId: data.tweetId || cls.tweetId,
                    success: true,
                    ...data.tweet,
                };
                if (Array.isArray(data.thread) && data.thread.length > 0 && opts.withThread) {
                    postData.threadTweets = data.thread;
                }
                if (Array.isArray(data.replies) && data.replies.length > 0 && opts.withReplies > 0) {
                    postData.replies = data.replies.slice(0, opts.withReplies);
                }
                if (data.meta) {
                    if (data.meta.timedOut) postData.timedOut = true;
                    if (data.meta.partial) postData.partial = true;
                    if (typeof data.meta.collectedReplyPages === 'number') {
                        postData.collectedReplyPages = data.meta.collectedReplyPages;
                    }
                    if (typeof data.meta.durationMs === 'number') postData.durationMs = data.meta.durationMs;
                }
                allResults.push(postData);
            } else {
                allResults.push({
                    [postResultKey(cls)]: resultId,
                    contentKind: cls.kind,
                    success: false,
                    error: cls.kind === 'article' ? 'no_article_body' : 'no_focal_tweet',
                });
            }
        }
        if (i < classifications.length - 1) await new Promise((r) => setTimeout(r, 1000));
    }

    return {
        scrapeType: 'x_post',
        scrapeOptions: { withThread: !!opts.withThread, withReplies: opts.withReplies || 0 },
        timestamp: new Date().toISOString(),
        totalRequested: classifications.length,
        totalSuccess: allResults.filter((r) => r.success).length,
        totalFailed: allResults.filter((r) => !r.success).length,
        results: allResults,
        _bridge: {
            target: lastTarget,
            bridge: lastBridge,
        },
    };
}

function postRunToolDispatch(classification) {
    if (classification && classification.kind === 'article') {
        return {
            method: 'getArticle',
            cmdDef: { ...READ_CMD_DEF.post, methodBase: 'getArticle' },
        };
    }
    return { method: 'getPost', cmdDef: READ_CMD_DEF.post };
}

  return {
    commonRunToolOptions,
    errFromRunTool,
    searchViaRunTool,
    profileViaRunTool,
    homeViaRunTool,
    postViaRunTool,
    postRunToolDispatch,
  };
}

module.exports = { createMethods };
