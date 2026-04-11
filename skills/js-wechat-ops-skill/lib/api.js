'use strict';

const { scrapeWechatArticle } = require('./wechatUtils');

async function getArticle(browser, url, options = {}) {
  void options;
  const result = await scrapeWechatArticle(browser, url);

  return {
    platform: 'wechat',
    scrapeType: 'wechat_article',
    timestamp: result.timestamp,
    sourceUrl: result.sourceUrl,
    result: result.data,
  };
}

module.exports = { getArticle };
