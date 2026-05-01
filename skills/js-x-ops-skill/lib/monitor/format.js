'use strict';

/**
 * monitor format - 把 ops-skill v3 schema 的 tweet 格式化成各通知渠道的 payload
 *
 * 输入 tweet schema 见 bridges/common.js::parseSingleTweetResult：
 *   { tweetId, author.{name,username,isVerified}, content, publishTime, stats.*, tweetUrl, isRetweet, isReply, lang, mediaUrls[] }
 */

function truncate(text, maxLen) {
  const t = String(text || '');
  if (t.length <= maxLen) return { text: t, truncated: false };
  return { text: t.slice(0, maxLen), truncated: true };
}

function normalizeUsername(author) {
  const u = (author && author.username) || '';
  return u.startsWith('@') ? u.slice(1) : u;
}

function tweetUrlOf(tweet) {
  if (tweet.tweetUrl) return tweet.tweetUrl;
  const uname = normalizeUsername(tweet.author);
  return uname && tweet.tweetId ? `https://x.com/${uname}/status/${tweet.tweetId}` : '';
}

function displayName(author) {
  const u = normalizeUsername(author);
  const name = (author && author.name) || u;
  return { name, username: u };
}

function formatConsole(tweet, options = {}) {
  const maxLen = options.summaryLength || 100;
  const { text, truncated } = truncate(tweet.content, maxLen);
  const { name, username } = displayName(tweet.author);
  const url = tweetUrlOf(tweet);
  const lines = [
    `[monitor] @${username} (${name})`,
    `  ${text}${truncated ? '...' : ''}`,
    `  ${url}`,
  ];
  if (tweet.publishTime) lines.push(`  publishTime: ${tweet.publishTime}`);
  return lines.join('\n');
}

function formatFeishu(tweet, options = {}) {
  const maxLen = options.summaryLength || 100;
  const { text, truncated } = truncate(tweet.content, maxLen);
  const { name, username } = displayName(tweet.author);
  const url = tweetUrlOf(tweet);
  const header = `🐦 @${username} 新推文`;
  const body = [
    `**${name}** (@${username})`,
    '',
    `${text}${truncated ? '...' : ''}`,
    '',
    `[查看原文](${url})`,
  ];
  if (tweet.publishTime) body.push(`⏰ ${tweet.publishTime}`);

  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: header },
        template: 'blue',
      },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: body.join('\n') } },
      ],
    },
  };
}

function formatDiscord(tweet, options = {}) {
  const maxLen = options.summaryLength || 280;
  const { text, truncated } = truncate(tweet.content, maxLen);
  const { name, username } = displayName(tweet.author);
  const url = tweetUrlOf(tweet);
  return {
    embeds: [
      {
        title: `@${username} 新推文`,
        description: `${text}${truncated ? '...' : ''}`,
        url,
        author: { name: `${name} (@${username})` },
        timestamp: tweet.publishTime || undefined,
        fields: [
          { name: 'likes', value: String(tweet.stats?.likes || 0), inline: true },
          { name: 'retweets', value: String(tweet.stats?.retweets || 0), inline: true },
          { name: 'replies', value: String(tweet.stats?.replies || 0), inline: true },
        ],
      },
    ],
  };
}

function formatGeneric(tweet, options = {}) {
  const maxLen = options.summaryLength || 280;
  const { text, truncated } = truncate(tweet.content, maxLen);
  const { name, username } = displayName(tweet.author);
  return {
    event: 'x.new_tweet',
    timestamp: new Date().toISOString(),
    tweet: {
      tweetId: tweet.tweetId,
      url: tweetUrlOf(tweet),
      content: `${text}${truncated ? '...' : ''}`,
      contentTruncated: truncated,
      publishTime: tweet.publishTime || null,
      lang: tweet.lang || null,
      author: { name, username, isVerified: !!(tweet.author && tweet.author.isVerified) },
      stats: tweet.stats || {},
      isRetweet: !!tweet.isRetweet,
      isReply: !!tweet.isReply,
      inReplyToTweetId: tweet.inReplyToTweetId || null,
    },
  };
}

module.exports = {
  formatConsole,
  formatFeishu,
  formatDiscord,
  formatGeneric,
  tweetUrlOf,
  truncate,
};
