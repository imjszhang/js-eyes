'use strict';

const { scrapeJikePost } = require('./jikeUtils');

async function getPost(browser, url, options = {}) {
  void options;
  const result = await scrapeJikePost(browser, url);

  return {
    platform: 'jike',
    scrapeType: 'jike_post',
    timestamp: result.timestamp,
    sourceUrl: result.sourceUrl,
    result: result.data,
  };
}

module.exports = { getPost };
