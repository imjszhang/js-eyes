'use strict';

/**
 * monitor dedup - 纯函数，无 I/O
 */

const crypto = require('crypto');

function hashContent(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

/**
 * 判断一条新采集到的 tweet 是否为"新推文"（相对于 knownIds/knownHashes）。
 * method: 'id_only' | 'hash_only' | 'id_and_hash'（默认，同时要求 ID 与 hash 都未见过）
 */
function isNewTweet(tweet, hash, knownIds, knownHashes, method = 'id_and_hash') {
  switch (method) {
    case 'id_only':
      return !knownIds.has(tweet.tweetId);
    case 'hash_only':
      return !knownHashes.has(hash);
    case 'id_and_hash':
    default:
      return !knownIds.has(tweet.tweetId) && !knownHashes.has(hash);
  }
}

/**
 * 对一批 fetched tweets 按 state 分桶：
 *   - fresh: 需要通知的新推文（带 hash、discoveredAt）
 *   - seen:  已经见过，无需通知
 *
 * @param {Array} fetched     从 ops-skill getProfileTweets 拿到的 v3 schema tweets
 * @param {Object} state      state.js::loadState 返回的结构
 * @param {string} method     去重策略
 * @param {string} nowIso     用于 discoveredAt（可注入便于测试）
 */
function partitionNewTweets(fetched, state, method = 'id_and_hash', nowIso = new Date().toISOString()) {
  const knownIds = new Set((state.tweets || []).map((t) => t.tweetId));
  const knownHashes = new Set((state.tweets || []).map((t) => t.hash).filter(Boolean));
  const fresh = [];
  const seen = [];

  for (const tweet of fetched || []) {
    if (!tweet || !tweet.tweetId) continue;
    const hash = hashContent(tweet.content || '');
    if (isNewTweet(tweet, hash, knownIds, knownHashes, method)) {
      fresh.push({
        tweet,
        record: {
          tweetId: tweet.tweetId,
          hash,
          publishTime: tweet.publishTime || null,
          discoveredAt: nowIso,
        },
      });
      knownIds.add(tweet.tweetId);
      knownHashes.add(hash);
    } else {
      seen.push(tweet);
    }
  }
  return { fresh, seen };
}

/**
 * 按 historyDays 清理过期 state 记录（按 discoveredAt 判定）。
 */
function pruneExpired(records, historyDays = 30, now = Date.now()) {
  const days = historyDays > 0 ? historyDays : 30;
  const cutoff = now - days * 86400000;
  return (records || []).filter((r) => {
    if (!r || !r.discoveredAt) return true;
    const t = Date.parse(r.discoveredAt);
    if (Number.isNaN(t)) return true;
    return t > cutoff;
  });
}

module.exports = {
  hashContent,
  isNewTweet,
  partitionNewTweets,
  pruneExpired,
};
