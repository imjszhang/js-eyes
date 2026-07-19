'use strict';

const {
  DEFAULT_GRAPHQL_FEATURES,
  BEARER_TOKEN,
  buildTweetParserSnippet,
  buildGraphQLTweetParserSnippet,
} = require('../lib/xUtils');
const { buildParseTweetResultSnippet } = require('./tweet-parser');

function buildDiscoverTweetQueryIdsScript() {
    return `
    (async () => {
        try {
            const result = {
                tweetDetailQueryId: null,
                tweetResultByRestIdQueryId: null,
                features: null
            };

            // 从 URL 中提取 features
            const parseFeatures = (urlStr) => {
                try {
                    const url = new URL(urlStr);
                    const fp = url.searchParams.get('features');
                    if (fp) return JSON.parse(fp);
                } catch (e) {}
                return null;
            };

            // 策略 1: 从 performance API 中匹配
            try {
                const resources = performance.getEntriesByType('resource');
                for (const r of resources) {
                    if (!result.tweetDetailQueryId) {
                        const m = r.name.match(/graphql\\/([A-Za-z0-9_-]+)\\/TweetDetail/);
                        if (m) {
                            result.tweetDetailQueryId = m[1];
                            if (!result.features) result.features = parseFeatures(r.name);
                        }
                    }
                    if (!result.tweetResultByRestIdQueryId) {
                        const m = r.name.match(/graphql\\/([A-Za-z0-9_-]+)\\/TweetResultByRestId/);
                        if (m) {
                            result.tweetResultByRestIdQueryId = m[1];
                            if (!result.features) result.features = parseFeatures(r.name);
                        }
                    }
                }
            } catch (e) {}

            // 策略 2: 从 JS bundle 中搜索
            if (!result.tweetDetailQueryId || !result.tweetResultByRestIdQueryId) {
                try {
                    const scripts = document.querySelectorAll('script[src]');
                    const bundleUrls = [];
                    for (const script of scripts) {
                        const src = script.getAttribute('src') || '';
                        if (src.includes('/client-web/') || src.includes('main.')) {
                            bundleUrls.push(src.startsWith('http') ? src : 'https://x.com' + src);
                        }
                    }

                    for (const bundleUrl of bundleUrls.slice(0, 8)) {
                        try {
                            const resp = await fetch(bundleUrl);
                            if (!resp.ok) continue;
                            const text = await resp.text();

                            if (!result.tweetDetailQueryId) {
                                const m = text.match(/queryId:"([A-Za-z0-9_-]+)",operationName:"TweetDetail"/);
                                if (m) result.tweetDetailQueryId = m[1];
                            }
                            if (!result.tweetResultByRestIdQueryId) {
                                const m = text.match(/queryId:"([A-Za-z0-9_-]+)",operationName:"TweetResultByRestId"/);
                                if (m) result.tweetResultByRestIdQueryId = m[1];
                            }

                            if (result.tweetDetailQueryId && result.tweetResultByRestIdQueryId) break;
                        } catch (e) {}
                    }
                } catch (e) {}
            }

            return { success: true, ...result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

function buildTweetDetailScript(tweetId, queryId, features, withThread = false, collectReplies = false) {
    const featuresToUse = features || DEFAULT_GRAPHQL_FEATURES;
    const featuresLiteral = JSON.stringify(featuresToUse);

    return `
    (async () => {
        try {
            const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
            if (!ct0) {
                return { success: false, error: '未找到 ct0 cookie，请确保已登录 X.com' };
            }

            const variables = {
                focalTweetId: '${tweetId}',
                with_rux_injections: false,
                rankingMode: 'Relevance',
                includePromotedContent: false,
                withCommunity: true,
                withQuickPromoteEligibilityTweetFields: true,
                withBirdwatchNotes: true,
                withVoice: true,
                withV2Timeline: true
            };

            const features = ${featuresLiteral};

            const fieldToggles = {
                withArticleRichContentState: true,
                withArticlePlainText: false,
                withGrokAnalyze: false,
                withDisallowedReplyControls: false
            };

            const apiUrl = 'https://x.com/i/api/graphql/${queryId}/TweetDetail?' +
                'variables=' + encodeURIComponent(JSON.stringify(variables)) +
                '&features=' + encodeURIComponent(JSON.stringify(features)) +
                '&fieldToggles=' + encodeURIComponent(JSON.stringify(fieldToggles));

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            let response;
            try {
                response = await fetch(apiUrl, {
                    signal: controller.signal,
                    credentials: 'include',
                    headers: {
                        'authorization': '${BEARER_TOKEN}',
                        'x-csrf-token': ct0,
                        'x-twitter-auth-type': 'OAuth2Session',
                        'x-twitter-active-user': 'yes',
                        'content-type': 'application/json'
                    }
                });
                clearTimeout(timeoutId);
            } catch (fetchError) {
                clearTimeout(timeoutId);
                if (fetchError.name === 'AbortError') {
                    return { success: false, error: 'GraphQL 请求超时' };
                }
                return { success: false, error: fetchError.message };
            }

            if (!response.ok) {
                const retryAfter = response.headers.get('retry-after') || null;
                let errorDetail = '';
                try { errorDetail = await response.text(); errorDetail = errorDetail.substring(0, 300); } catch(e) {}
                return {
                    success: false,
                    error: 'HTTP ' + response.status + (errorDetail ? ': ' + errorDetail : ''),
                    statusCode: response.status,
                    retryAfter: retryAfter ? parseInt(retryAfter, 10) : null
                };
            }

            const data = await response.json();

            try {
                const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];

                let allEntries = [];
                for (const instruction of instructions) {
                    if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
                        allEntries = allEntries.concat(instruction.entries);
                    }
                }

                ${buildParseTweetResultSnippet()}

                // 解析 focal tweet（主推文）
                let focalTweet = null;
                const threadTweets = [];
                const replies = [];
                let replyCursor = null;

                // 遍历所有 entries，分类为线程/focal/回复
                for (const entry of allEntries) {
                    const entryId = entry.entryId || '';

                    // 提取回复分页游标
                    if (entryId.startsWith('cursor-bottom-')) {
                        replyCursor = entry.content?.itemContent?.value
                            || entry.content?.value || null;
                        continue;
                    }
                    if (entryId.startsWith('cursor-')) continue;

                    // 单条推文 entry
                    if (entryId.startsWith('tweet-')) {
                        const tweetResult = entry.content?.itemContent?.tweet_results?.result;
                        if (!tweetResult) continue;

                        const parsed = parseTweetResult(tweetResult);
                        if (!parsed) continue;

                        if (parsed.tweetId === '${tweetId}') {
                            focalTweet = parsed;
                        } else if (!focalTweet) {
                            threadTweets.push(parsed);
                        } else {
                            replies.push(parsed);
                        }
                        continue;
                    }

                    // 对话模块（conversationthread-）包含多条推文
                    if (entryId.startsWith('conversationthread-')) {
                        const items = entry.content?.items || [];
                        for (const item of items) {
                            const tweetResult = item.item?.itemContent?.tweet_results?.result;
                            if (!tweetResult) continue;

                            const parsed = parseTweetResult(tweetResult);
                            if (!parsed) continue;

                            if (parsed.tweetId === '${tweetId}') {
                                focalTweet = parsed;
                            } else if (!focalTweet) {
                                threadTweets.push(parsed);
                            } else {
                                replies.push(parsed);
                            }
                        }
                    }
                }

                if (!focalTweet) {
                    return { success: false, error: '未找到目标推文，可能已删除或不可见' };
                }

                const result = {
                    success: true,
                    focalTweet: focalTweet,
                    replyCursor: replyCursor
                };

                if (${withThread ? 'true' : 'false'}) {
                    result.threadTweets = threadTweets;
                }

                if (${collectReplies ? 'true' : 'false'}) {
                    result.replies = replies;
                }

                return result;
            } catch (parseError) {
                return { success: false, error: '解析响应失败: ' + parseError.message, raw: JSON.stringify(data).substring(0, 500) };
            }
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

function buildTweetDetailCursorScript(tweetId, cursor, queryId, features) {
    const featuresToUse = features || DEFAULT_GRAPHQL_FEATURES;
    const featuresLiteral = JSON.stringify(featuresToUse);
    const safeCursor = (cursor || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');

    return `
    (async () => {
        try {
            const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
            if (!ct0) {
                return { success: false, error: '未找到 ct0 cookie，请确保已登录 X.com' };
            }

            const variables = {
                focalTweetId: '${tweetId}',
                cursor: '${safeCursor}',
                referrer: 'tweet',
                with_rux_injections: false,
                rankingMode: 'Relevance',
                includePromotedContent: false,
                withCommunity: true,
                withQuickPromoteEligibilityTweetFields: true,
                withBirdwatchNotes: true,
                withVoice: true,
                withV2Timeline: true
            };

            const features = ${featuresLiteral};

            const fieldToggles = {
                withArticleRichContentState: true,
                withArticlePlainText: false,
                withGrokAnalyze: false,
                withDisallowedReplyControls: false
            };

            const apiUrl = 'https://x.com/i/api/graphql/${queryId}/TweetDetail?' +
                'variables=' + encodeURIComponent(JSON.stringify(variables)) +
                '&features=' + encodeURIComponent(JSON.stringify(features)) +
                '&fieldToggles=' + encodeURIComponent(JSON.stringify(fieldToggles));

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            let response;
            try {
                response = await fetch(apiUrl, {
                    signal: controller.signal,
                    credentials: 'include',
                    headers: {
                        'authorization': '${BEARER_TOKEN}',
                        'x-csrf-token': ct0,
                        'x-twitter-auth-type': 'OAuth2Session',
                        'x-twitter-active-user': 'yes',
                        'content-type': 'application/json'
                    }
                });
                clearTimeout(timeoutId);
            } catch (fetchError) {
                clearTimeout(timeoutId);
                if (fetchError.name === 'AbortError') {
                    return { success: false, error: 'GraphQL 请求超时' };
                }
                return { success: false, error: fetchError.message };
            }

            if (!response.ok) {
                const retryAfter = response.headers.get('retry-after') || null;
                let errorDetail = '';
                try { errorDetail = await response.text(); errorDetail = errorDetail.substring(0, 300); } catch(e) {}
                return {
                    success: false,
                    error: 'HTTP ' + response.status + (errorDetail ? ': ' + errorDetail : ''),
                    statusCode: response.status,
                    retryAfter: retryAfter ? parseInt(retryAfter, 10) : null
                };
            }

            const data = await response.json();

            try {
                const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];

                let allEntries = [];
                for (const instruction of instructions) {
                    if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
                        allEntries = allEntries.concat(instruction.entries);
                    }
                    // TimelineAddToModule 可能包含嵌套的回复
                    if (instruction.type === 'TimelineAddToModule' && instruction.moduleItems) {
                        for (const moduleItem of instruction.moduleItems) {
                            if (moduleItem.item?.itemContent?.tweet_results?.result) {
                                allEntries.push({
                                    entryId: 'moduletweet-' + (moduleItem.item?.itemContent?.tweet_results?.result?.rest_id || ''),
                                    content: { itemContent: moduleItem.item.itemContent }
                                });
                            }
                        }
                    }
                }

                ${buildParseTweetResultSnippet()}

                const replies = [];
                let nextCursor = null;

                for (const entry of allEntries) {
                    const entryId = entry.entryId || '';

                    // 提取下一页游标
                    if (entryId.startsWith('cursor-bottom-')) {
                        nextCursor = entry.content?.itemContent?.value
                            || entry.content?.value || null;
                        continue;
                    }
                    if (entryId.startsWith('cursor-')) continue;

                    // 单条推文
                    if (entryId.startsWith('tweet-') || entryId.startsWith('moduletweet-')) {
                        const tweetResult = entry.content?.itemContent?.tweet_results?.result;
                        if (!tweetResult) continue;

                        const parsed = parseTweetResult(tweetResult);
                        if (parsed && parsed.tweetId !== '${tweetId}') {
                            replies.push(parsed);
                        }
                        continue;
                    }

                    // 对话模块
                    if (entryId.startsWith('conversationthread-')) {
                        const items = entry.content?.items || [];
                        for (const item of items) {
                            const tweetResult = item.item?.itemContent?.tweet_results?.result;
                            if (!tweetResult) continue;

                            const parsed = parseTweetResult(tweetResult);
                            if (parsed && parsed.tweetId !== '${tweetId}') {
                                replies.push(parsed);
                            }
                        }
                    }
                }

                return {
                    success: true,
                    replies: replies,
                    nextCursor: nextCursor
                };
            } catch (parseError) {
                return { success: false, error: '解析回复分页失败: ' + parseError.message };
            }
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}



function buildTweetByRestIdScript(tweetId, queryId, features) {
    const featuresToUse = features || DEFAULT_GRAPHQL_FEATURES;
    const featuresLiteral = JSON.stringify(featuresToUse);

    return `
    (async () => {
        try {
            const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
            if (!ct0) {
                return { success: false, error: '未找到 ct0 cookie，请确保已登录 X.com' };
            }

            const variables = {
                tweetId: '${tweetId}',
                withCommunity: true,
                includePromotedContent: false,
                withVoice: true
            };

            const features = ${featuresLiteral};

            const apiUrl = 'https://x.com/i/api/graphql/${queryId}/TweetResultByRestId?' +
                'variables=' + encodeURIComponent(JSON.stringify(variables)) +
                '&features=' + encodeURIComponent(JSON.stringify(features));

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            let response;
            try {
                response = await fetch(apiUrl, {
                    signal: controller.signal,
                    credentials: 'include',
                    headers: {
                        'authorization': '${BEARER_TOKEN}',
                        'x-csrf-token': ct0,
                        'x-twitter-auth-type': 'OAuth2Session',
                        'x-twitter-active-user': 'yes',
                        'content-type': 'application/json'
                    }
                });
                clearTimeout(timeoutId);
            } catch (fetchError) {
                clearTimeout(timeoutId);
                if (fetchError.name === 'AbortError') {
                    return { success: false, error: 'GraphQL 请求超时' };
                }
                return { success: false, error: fetchError.message };
            }

            if (!response.ok) {
                const retryAfter = response.headers.get('retry-after') || null;
                let errorDetail = '';
                try { errorDetail = await response.text(); errorDetail = errorDetail.substring(0, 300); } catch(e) {}
                return {
                    success: false,
                    error: 'HTTP ' + response.status + (errorDetail ? ': ' + errorDetail : ''),
                    statusCode: response.status,
                    retryAfter: retryAfter ? parseInt(retryAfter, 10) : null
                };
            }

            const data = await response.json();

            try {
                const tweetResult = data?.data?.tweetResult?.result;
                if (!tweetResult) {
                    return { success: false, error: '推文不存在或已删除' };
                }

                const actualTweet = tweetResult.tweet || tweetResult;
                const legacy = actualTweet.legacy;
                if (!legacy) {
                    return { success: false, error: '推文数据结构异常' };
                }

                const userResult = actualTweet.core?.user_results?.result;
                const userLegacy = userResult?.legacy;
                const userCore = userResult?.core;
                const userAvatar = userResult?.avatar;

                // 提取媒体
                const mediaUrls = [];
                const mediaDetails = [];
                const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];

                mediaEntities.forEach(media => {
                    if (media.type === 'photo' && media.media_url_https) {
                        mediaUrls.push(media.media_url_https);
                        mediaDetails.push({
                            type: 'photo',
                            url: media.media_url_https,
                            expandedUrl: media.expanded_url || '',
                            width: media.original_info?.width || 0,
                            height: media.original_info?.height || 0
                        });
                    } else if (media.type === 'video' || media.type === 'animated_gif') {
                        const variants = (media.video_info?.variants || [])
                            .filter(v => v.content_type === 'video/mp4')
                            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                        const bestMp4 = variants[0];
                        if (bestMp4) {
                            mediaUrls.push(bestMp4.url);
                        }

                        const m3u8 = (media.video_info?.variants || [])
                            .find(v => v.content_type === 'application/x-mpegURL');

                        mediaDetails.push({
                            type: media.type,
                            posterUrl: media.media_url_https || '',
                            duration: media.video_info?.duration_millis || 0,
                            variants: (media.video_info?.variants || []).map(v => ({
                                url: v.url,
                                contentType: v.content_type,
                                bitrate: v.bitrate || 0
                            })),
                            bestMp4Url: bestMp4?.url || '',
                            m3u8Url: m3u8?.url || '',
                            width: media.original_info?.width || 0,
                            height: media.original_info?.height || 0
                        });
                    }
                });

                // 提取引用推文
                let quoteTweet = null;
                const quotedResult = legacy.quoted_status_result?.result
                    || actualTweet.quoted_status_result?.result;
                if (quotedResult) {
                    const qt = quotedResult.tweet || quotedResult;
                    const qtLegacy = qt.legacy;
                    if (qtLegacy) {
                        const qtUser = qt.core?.user_results?.result;
                        const qtUserLegacy = qtUser?.legacy;
                        const qtUserCore = qtUser?.core;
                        const qtScreenName = qtUserCore?.screen_name || qtUserLegacy?.screen_name || '';
                        quoteTweet = {
                            tweetId: qtLegacy.id_str || qt.rest_id || '',
                            author: {
                                name: qtUserCore?.name || qtUserLegacy?.name || '',
                                username: '@' + qtScreenName,
                            },
                            content: qtLegacy.full_text || '',
                            publishTime: qtLegacy.created_at || '',
                            tweetUrl: qtScreenName ? ('https://x.com/' + qtScreenName + '/status/' + (qtLegacy.id_str || qt.rest_id)) : ''
                        };
                    }
                }

                // 提取卡片
                let card = null;
                const cardData = actualTweet.card?.legacy;
                if (cardData) {
                    const bindingValues = {};
                    (cardData.binding_values || []).forEach(bv => {
                        const val = bv.value?.string_value || bv.value?.image_value?.url || '';
                        if (val) bindingValues[bv.key] = val;
                    });
                    card = {
                        name: cardData.name || '',
                        title: bindingValues.title || '',
                        description: bindingValues.description || '',
                        url: bindingValues.card_url || bindingValues.url || '',
                        thumbnailUrl: bindingValues.thumbnail_image_original || bindingValues.thumbnail_image || '',
                        domain: bindingValues.domain || bindingValues.vanity_url || ''
                    };
                }

                const noteText = actualTweet.note_tweet?.note_tweet_results?.result?.text || '';
                const screenName = userCore?.screen_name || userLegacy?.screen_name || '';
                const tweetIdStr = legacy.id_str || actualTweet.rest_id || '';

                return {
                    success: true,
                    focalTweet: {
                        tweetId: tweetIdStr,
                        author: {
                            name: userCore?.name || userLegacy?.name || '',
                            username: '@' + screenName,
                            avatarUrl: userAvatar?.image_url || userLegacy?.profile_image_url_https || '',
                            isVerified: userResult?.is_blue_verified || false
                        },
                        content: noteText || legacy.full_text || '',
                        publishTime: legacy.created_at || '',
                        lang: legacy.lang || '',
                        stats: {
                            replies: legacy.reply_count || 0,
                            retweets: legacy.retweet_count || 0,
                            likes: legacy.favorite_count || 0,
                            views: parseInt(actualTweet.views?.count, 10) || 0,
                            bookmarks: legacy.bookmark_count || 0,
                            quotes: legacy.quote_count || 0
                        },
                        mediaUrls: [...new Set(mediaUrls)],
                        mediaDetails: mediaDetails,
                        tweetUrl: screenName && tweetIdStr ? ('https://x.com/' + screenName + '/status/' + tweetIdStr) : '',
                        isRetweet: !!legacy.retweeted_status_result,
                        isReply: !!legacy.in_reply_to_status_id_str,
                        inReplyToTweetId: legacy.in_reply_to_status_id_str || null,
                        inReplyToUser: legacy.in_reply_to_screen_name || null,
                        conversationId: legacy.conversation_id_str || '',
                        quoteTweet: quoteTweet,
                        card: card,
                        source: actualTweet.source || ''
                    }
                };
            } catch (parseError) {
                return { success: false, error: '解析响应失败: ' + parseError.message };
            }
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

module.exports = {
  buildDiscoverTweetQueryIdsScript,
  buildTweetDetailScript,
  buildTweetDetailCursorScript,
  buildParseTweetResultSnippet,
  buildTweetByRestIdScript,
};
