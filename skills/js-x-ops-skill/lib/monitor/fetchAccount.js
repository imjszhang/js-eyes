'use strict';

/**
 * monitor fetchAccount - 复用 lib/api.js::getProfileTweets 拉单个账号的近期时间线
 *
 * 返回: { ok, tweets: [...], profile, meta }
 * 不抛错（除非完全无法连接 browser）；ok=false 时附 error。
 */

const { getProfileTweets } = require('../api');

/**
 * @param {import('../js-eyes-client').BrowserAutomation} browser
 * @param {Object} settings   effectiveAccountSettings 的返回值
 * @param {Object} options    { recording, logger }
 */
async function fetchAccount(browser, settings, options = {}) {
  const username = settings.username;
  try {
    const resp = await getProfileTweets(browser, username, {
      maxPages: settings.maxPagesPerCheck || 1,
      includeReplies: !!settings.includeReplies,
      includeRetweets: !!settings.includeRetweets,
      minLikes: settings.minLikes || 0,
      recording: options.recording,
      logger: options.logger,
      /** monitor：仅 GraphQL，避免 DOM/visual 与 daemon 写盘放大（见 docs/dev/monitor.md） */
      readMode: 'graphql',
    });

    const rawTweets = Array.isArray(resp.results) ? resp.results : [];

    // 应用 include flags：bridge 层拿到的可能仍含 retweet/reply
    const filtered = rawTweets.filter((t) => {
      if (!t || !t.tweetId) return false;
      if (!settings.includeRetweets && t.isRetweet) return false;
      if (!settings.includeReplies && (t.isReply || t.inReplyToTweetId)) return false;
      return true;
    });

    return {
      ok: true,
      username,
      tweets: filtered,
      rawCount: rawTweets.length,
      profile: resp.profile || null,
      meta: {
        totalResults: resp.totalResults || rawTweets.length,
        bridgeUsed: resp.metrics?.bridgeUsed === true,
        bridgeFallback: resp.metrics?.bridgeFallback === true,
        bridgeFallbackReason: resp.metrics?.bridgeFallbackReason || null,
        runId: resp.run?.id || null,
        durationMs: resp.metrics?.durationMs || null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      username,
      tweets: [],
      rawCount: 0,
      profile: null,
      error: { message: err.message, code: err.code || null },
      meta: null,
    };
  }
}

module.exports = { fetchAccount };
