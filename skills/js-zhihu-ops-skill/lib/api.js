'use strict';

const {
  scrapeZhihuAnswer,
  scrapeZhihuArticle,
} = require('./zhihuUtils');

async function getAnswer(browser, url, options = {}) {
  void options;
  const result = await scrapeZhihuAnswer(browser, url);

  return {
    platform: 'zhihu',
    scrapeType: 'zhihu_answer',
    timestamp: result.timestamp,
    sourceUrl: result.sourceUrl,
    result: result.data,
  };
}

async function getArticle(browser, url, options = {}) {
  void options;
  const result = await scrapeZhihuArticle(browser, url);

  return {
    platform: 'zhihu',
    scrapeType: 'zhihu_article',
    timestamp: result.timestamp,
    sourceUrl: result.sourceUrl,
    result: result.data,
  };
}

module.exports = { getAnswer, getArticle };
