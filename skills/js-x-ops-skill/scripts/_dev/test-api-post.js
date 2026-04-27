'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { BrowserAutomation } = require(path.join(ROOT, 'lib', 'js-eyes-client'));
const { getPost } = require(path.join(ROOT, 'lib', 'api'));

async function main() {
  const url = process.argv[2] || 'https://x.com/elonmusk/status/1948985576147091890';
  const bot = new BrowserAutomation('ws://localhost:18080', {
    logger: { info: () => {}, warn: () => {}, error: console.error }
  });
  await bot.connect();
  try {
    const r = await getPost(bot, url, { withThread: false, withReplies: 0, recordingMode: 'off', noCache: true });
    console.log('totalRequested:', r.totalRequested, 'totalSuccess:', r.totalSuccess, 'totalFailed:', r.totalFailed);
    console.log('metrics:', JSON.stringify(r.metrics, null, 2));
    if (r.results[0]) {
      const t = r.results[0];
      console.log('post:', JSON.stringify({
        tweetId: t.tweetId,
        success: t.success,
        author: t.author,
        contentLen: (t.content || '').length,
        error: t.error,
      }, null, 2));
    }
  } finally {
    bot.disconnect();
  }
}
main().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
