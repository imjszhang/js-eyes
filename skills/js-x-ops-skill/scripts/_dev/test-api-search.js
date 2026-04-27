'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { BrowserAutomation } = require(path.join(ROOT, 'lib', 'js-eyes-client'));
const { searchTweets } = require(path.join(ROOT, 'lib', 'api'));

async function main() {
  const bot = new BrowserAutomation('ws://localhost:18080', {
    logger: { info: () => {}, warn: () => {}, error: console.error }
  });
  await bot.connect();
  try {
    const r = await searchTweets(bot, 'AI agent', { sort: 'top', maxPages: 1, recordingMode: 'off', noCache: true });
    console.log('totalResults:', r.totalResults);
    console.log('searchUrl:', r.searchUrl);
    console.log('metrics:', JSON.stringify(r.metrics, null, 2));
    if (r.results[0]) {
      console.log('first tweet:', JSON.stringify({
        tweetId: r.results[0].tweetId,
        author: r.results[0].author,
        contentLen: (r.results[0].content || '').length,
      }, null, 2));
    }
  } finally {
    bot.disconnect();
  }
}
main().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
