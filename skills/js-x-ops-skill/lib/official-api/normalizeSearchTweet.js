'use strict';

const { normalizePhotoUrl, pickBestMp4 } = require('../media');

function mapMediaDetails(mediaItems) {
  const details = [];
  const mediaUrls = [];

  for (const item of (mediaItems || [])) {
    if (!item || typeof item !== 'object') continue;
    const type = item.type || 'unknown';

    if (type === 'photo') {
      const url = normalizePhotoUrl(item.url) || item.url || '';
      if (!url) continue;
      mediaUrls.push(url);
      details.push({
        type: 'photo',
        url,
        width: item.width || null,
        height: item.height || null,
      });
    } else if (type === 'video' || type === 'animated_gif') {
      const variants = Array.isArray(item.variants) ? item.variants : [];
      const mp4Urls = variants
        .filter((v) => v.content_type === 'video/mp4' && v.url)
        .map((v) => v.url);
      const bestMp4 = pickBestMp4(mp4Urls)[0] || '';
      const preview = item.preview_image_url || '';
      const url = bestMp4 || preview;
      if (url) mediaUrls.push(url);
      details.push({
        type: type === 'animated_gif' ? 'animated_gif' : 'video',
        url: preview || bestMp4,
        posterUrl: preview || null,
        duration: item.duration_ms ? Math.round(item.duration_ms / 1000) : null,
        variants: variants.map((v) => ({
          url: v.url,
          content_type: v.content_type,
          bit_rate: v.bit_rate,
        })),
        bestMp4Url: bestMp4 || null,
      });
    }
  }

  return {
    mediaUrls: [...new Set(mediaUrls.filter(Boolean))],
    mediaDetails: details,
  };
}

function normalizeSearchTweet(tweet) {
  if (!tweet || typeof tweet !== 'object') return null;

  const tweetId = String(tweet.id || tweet.tweetId || '').trim();
  if (!tweetId) return null;

  const username = String(tweet.author_username || '').replace(/^@/, '');
  const metrics = tweet.public_metrics || {};
  const referenced = Array.isArray(tweet.referenced_tweets) ? tweet.referenced_tweets : [];
  const isRetweet = referenced.some((r) => r.type === 'retweeted');
  const isReply = referenced.some((r) => r.type === 'replied_to');
  const replyRef = referenced.find((r) => r.type === 'replied_to');

  const { mediaUrls, mediaDetails } = mapMediaDetails(tweet.media);

  return {
    tweetId,
    content: tweet.text || '',
    publishTime: tweet.created_at || '',
    lang: tweet.lang || '',
    author: {
      name: tweet.author_name || '',
      username: username ? `@${username}` : '',
      avatarUrl: tweet.author_avatar_url || '',
      isVerified: !!tweet.author_verified,
    },
    stats: {
      replies: metrics.reply_count || 0,
      retweets: metrics.retweet_count || 0,
      likes: metrics.like_count || 0,
      views: metrics.impression_count || 0,
      quotes: metrics.quote_count || 0,
      bookmarks: metrics.bookmark_count || 0,
    },
    mediaUrls,
    mediaDetails,
    tweetUrl: username ? `https://x.com/${username}/status/${tweetId}` : '',
    isRetweet,
    isReply,
    inReplyToTweetId: replyRef?.id || null,
    conversationId: tweet.conversation_id || '',
    source: 'official_api',
  };
}

function normalizeSearchResults(payload) {
  const tweets = (payload?.tweets || payload?.data || [])
    .map(normalizeSearchTweet)
    .filter(Boolean);
  return {
    tweets,
    total: tweets.length,
  };
}

module.exports = {
  normalizeSearchTweet,
  normalizeSearchResults,
  mapMediaDetails,
};
