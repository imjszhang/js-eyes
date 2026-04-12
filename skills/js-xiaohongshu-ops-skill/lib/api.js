'use strict';

const { scrapeXhsNote } = require('./xiaohongshuUtils');

async function getNote(browser, url, options = {}) {
  const result = await scrapeXhsNote(browser, url, options);

  return {
    platform: 'xiaohongshu',
    scrapeType: 'xiaohongshu_note',
    timestamp: result.timestamp,
    sourceUrl: result.sourceUrl,
    result: result.data,
  };
}

module.exports = { getNote };
