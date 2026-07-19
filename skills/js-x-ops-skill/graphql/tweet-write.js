'use strict';

const { DEFAULT_GRAPHQL_FEATURES, BEARER_TOKEN } = require('../lib/xUtils');

function buildDiscoverCreateTweetQueryIdScript() {
    return `
    (async () => {
        try {
            let createTweetQueryId = null;
            let features = null;
            const parseFeatures = (urlStr) => {
                try {
                    const url = new URL(urlStr);
                    const fp = url.searchParams.get('features');
                    if (fp) return JSON.parse(fp);
                } catch (e) {}
                return null;
            };
            try {
                const resources = performance.getEntriesByType('resource');
                for (const r of resources) {
                    const m = r.name.match(/graphql\\/([A-Za-z0-9_-]+)\\/CreateTweet/);
                    if (m) {
                        createTweetQueryId = m[1];
                        features = features || parseFeatures(r.name);
                        break;
                    }
                }
            } catch (e) {}
            if (!createTweetQueryId) {
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
                            const m = text.match(/queryId:"([A-Za-z0-9_-]+)",operationName:"CreateTweet"/);
                            if (m) {
                                createTweetQueryId = m[1];
                                break;
                            }
                        } catch (e) {}
                    }
                } catch (e) {}
            }
            return { success: true, createTweetQueryId, features };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

function buildCreateReplyScript(tweetId, replyText, queryId, features) {
    const featuresToUse = features || DEFAULT_GRAPHQL_FEATURES;
    const featuresLiteral = JSON.stringify(featuresToUse);
    const variables = {
        tweet_text: replyText || '',
        reply: {
            in_reply_to_tweet_id: String(tweetId),
            exclude_reply_user_ids: []
        },
        dark_request: false
    };
    const variablesStr = JSON.stringify(variables).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    return `
    (async () => {
        try {
            const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
            if (!ct0) {
                return { success: false, error: '未找到 ct0 cookie，请确保已登录 X.com' };
            }
            const features = ${featuresLiteral};
            const apiUrl = 'https://x.com/i/api/graphql/${queryId}/CreateTweet';
            const body = JSON.stringify({
                variables: ${variablesStr},
                features: features,
                fieldToggles: { withArticleRichContentState: false }
            });
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            let response;
            try {
                response = await fetch(apiUrl, {
                    method: 'POST',
                    signal: controller.signal,
                    credentials: 'include',
                    headers: {
                        'authorization': '${BEARER_TOKEN}',
                        'x-csrf-token': ct0,
                        'x-twitter-auth-type': 'OAuth2Session',
                        'x-twitter-active-user': 'yes',
                        'content-type': 'application/json'
                    },
                    body: body
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
                const text = await response.text().catch(() => '');
                return {
                    success: false,
                    error: 'HTTP ' + response.status,
                    statusCode: response.status
                };
            }
            const data = await response.json();
            const err = data?.errors?.[0];
            if (err) {
                return { success: false, error: err.message || JSON.stringify(err) };
            }
            var restId = null;
            var ct = data?.data?.create_tweet;
            if (ct) {
                restId = ct.rest_id
                    || ct.result?.rest_id
                    || ct.result?.tweet?.rest_id
                    || ct.result?.tweet_results?.result?.rest_id
                    || ct.tweet_results?.result?.rest_id
                    || ct.tweet_results?.result?.tweet?.rest_id;
            }
            if (restId) {
                return { success: true, tweetId: String(restId) };
            }
            if (ct !== undefined) {
                return { success: true, tweetId: '', _debug: JSON.stringify(data).substring(0, 500) };
            }
            return { success: false, error: 'GraphQL 响应无 create_tweet: ' + JSON.stringify(data).substring(0, 300) };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

function buildCreateNewTweetScript(tweetText, queryId, features, attachmentUrl) {
    const featuresToUse = features || DEFAULT_GRAPHQL_FEATURES;
    const featuresLiteral = JSON.stringify(featuresToUse);
    const variables = {
        tweet_text: tweetText || '',
        dark_request: false
    };
    if (attachmentUrl) {
        variables.attachment_url = attachmentUrl;
    }
    const variablesStr = JSON.stringify(variables).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    return `
    (async () => {
        try {
            const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
            if (!ct0) {
                return { success: false, error: '未找到 ct0 cookie，请确保已登录 X.com' };
            }
            const features = ${featuresLiteral};
            const apiUrl = 'https://x.com/i/api/graphql/${queryId}/CreateTweet';
            const body = JSON.stringify({
                variables: ${variablesStr},
                features: features,
                fieldToggles: { withArticleRichContentState: false }
            });
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            let response;
            try {
                response = await fetch(apiUrl, {
                    method: 'POST',
                    signal: controller.signal,
                    credentials: 'include',
                    headers: {
                        'authorization': '${BEARER_TOKEN}',
                        'x-csrf-token': ct0,
                        'x-twitter-auth-type': 'OAuth2Session',
                        'x-twitter-active-user': 'yes',
                        'content-type': 'application/json'
                    },
                    body: body
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
                const text = await response.text().catch(() => '');
                return {
                    success: false,
                    error: 'HTTP ' + response.status,
                    statusCode: response.status
                };
            }
            const data = await response.json();
            const err = data?.errors?.[0];
            if (err) {
                return { success: false, error: err.message || JSON.stringify(err) };
            }
            var restId = null;
            var ct = data?.data?.create_tweet;
            if (ct) {
                restId = ct.rest_id
                    || ct.result?.rest_id
                    || ct.result?.tweet?.rest_id
                    || ct.result?.tweet_results?.result?.rest_id
                    || ct.tweet_results?.result?.rest_id
                    || ct.tweet_results?.result?.tweet?.rest_id;
            }
            if (restId) {
                return { success: true, tweetId: String(restId) };
            }
            if (ct !== undefined) {
                return { success: true, tweetId: '', _debug: JSON.stringify(data).substring(0, 500) };
            }
            return { success: false, error: 'GraphQL 响应无 create_tweet: ' + JSON.stringify(data).substring(0, 300) };
        } catch (e) {
            return { success: false, error: e.message };
        }
    })();
    `;
}

module.exports = {
  buildDiscoverCreateTweetQueryIdScript,
  buildCreateReplyScript,
  buildCreateNewTweetScript,
};
