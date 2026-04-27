'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { BrowserAutomation } = require(path.join(ROOT, 'lib', 'js-eyes-client'));
const { getHomeFeed } = require(path.join(ROOT, 'lib', 'api'));

async function main() {
  const bot = new BrowserAutomation('ws://localhost:18080', {
    logger: { info: () => {}, warn: () => {}, error: console.error }
  });
  await bot.connect();
  try {
    const r = await getHomeFeed(bot, { feed: 'foryou', maxPages: 1, recordingMode: 'off', noCache: true });
    console.log('totalResults:', r.totalResults);
    console.log('metrics:', JSON.stringify(r.metrics, null, 2));
    if (r.results[0]) {
      console.log('first tweet author:', r.results[0].author);
    }
  } finally {
    bot.disconnect();
  }
}
main().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
