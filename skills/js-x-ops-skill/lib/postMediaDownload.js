'use strict';

const path = require('path');
const { listMediaFromTweet, listMediaFromArticle } = require('./media');
const { downloadMedia } = require('./downloadMedia');

/**
 * 为 getPost / runTool post 结果附加 media_files 落盘信息
 * @param {object} data
 * @param {{ downloadMedia?: boolean, outDir?: string, logger?: object }} options
 */
async function attachPostMediaDownloads(data, options = {}) {
  if (!options.downloadMedia || !data) return data;
  const baseOut = options.outDir || path.join(process.cwd(), 'media');
  const logFn = (msg) => {
    if (options.logger && typeof options.logger.info === 'function') options.logger.info(msg);
    else if (options.logger && typeof options.logger.log === 'function') options.logger.log(msg);
  };

  if (Array.isArray(data.results)) {
    for (const r of data.results) {
      if (r.success === false) continue;
      const isArticle = r.contentKind === 'article' || r.articleId;
      const id = isArticle ? (r.articleId || 'unknown') : (r.tweetId || (r.tweet && r.tweet.tweetId));
      const mediaSource = isArticle ? r : (r.tweet || r);
      const outDir = path.join(baseOut, String(id || 'unknown'));
      const items = isArticle ? listMediaFromArticle(mediaSource) : listMediaFromTweet(mediaSource);
      r.media_files = await downloadMedia(items, outDir, { logger: logFn });
      r.media_out_dir = outDir;
    }
    return data;
  }

  if (data.tweet) {
    const tweetId = data.tweet.tweetId;
    const outDir = path.join(baseOut, String(tweetId || 'unknown'));
    const items = listMediaFromTweet(data.tweet);
    data.media_files = await downloadMedia(items, outDir, { logger: logFn });
    data.media_out_dir = outDir;
    return data;
  }

  if (data.mediaDetails || data.mediaUrls) {
    const tweetId = data.tweetId;
    const outDir = path.join(baseOut, String(tweetId || 'unknown'));
    const items = listMediaFromTweet(data);
    data.media_files = await downloadMedia(items, outDir, { logger: logFn });
    data.media_out_dir = outDir;
  }

  return data;
}

module.exports = { attachPostMediaDownloads };
