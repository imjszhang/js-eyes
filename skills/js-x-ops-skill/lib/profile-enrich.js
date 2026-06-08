'use strict';

const { createOfficialApiClient } = require('./official-api');

function extractPinnedTweetId(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const direct = profile.pinnedTweetId || profile.pinned_tweet_id;
  if (direct) return String(direct);
  const ids = profile.pinned_tweet_ids_str || profile.pinned_tweet_ids;
  if (Array.isArray(ids) && ids.length) return String(ids[0]);
  return '';
}

function markPinnedTweets(tweets, pinnedTweetId) {
  if (!pinnedTweetId || !Array.isArray(tweets)) return tweets;
  const id = String(pinnedTweetId);
  return tweets.map((tw) => (
    String(tw.tweetId || tw.tweet_id || '') === id
      ? { ...tw, isPinned: true }
      : tw
  ));
}

async function enrichProfilePinnedTweet(profile, username, logger) {
  const base = profile && typeof profile === 'object' ? { ...profile } : {};
  if (extractPinnedTweetId(base)) return base;

  try {
    const client = createOfficialApiClient({ logger });
    if (!client.isWriteConfigured && !client.isReadConfigured) return base;
    const user = await client.getUserByUsername(username, { userFields: 'pinned_tweet_id' });
    const pinnedId = user?.pinned_tweet_id;
    if (pinnedId) {
      base.pinnedTweetId = String(pinnedId);
      base.pinned_tweet_ids_str = [String(pinnedId)];
    }
  } catch (err) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`enrichProfilePinnedTweet failed: ${err.message || err}`);
    }
  }

  return base;
}

module.exports = {
  enrichProfilePinnedTweet,
  extractPinnedTweetId,
  markPinnedTweets,
};
