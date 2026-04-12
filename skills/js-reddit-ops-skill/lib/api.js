'use strict';

const { scrapeRedditPost } = require('./redditUtils');

async function getPost(browser, url, options = {}) {
  void options;
  const result = await scrapeRedditPost(browser, url);

  return {
    platform: 'reddit',
    scrapeType: 'reddit_post',
    timestamp: result.timestamp,
    sourceUrl: result.sourceUrl,
    result: result.data,
  };
}

module.exports = { getPost };
