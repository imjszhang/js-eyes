'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { BrowserAutomation } = require(path.join(ROOT, 'lib', 'js-eyes-client'));
const { Session } = require(path.join(ROOT, 'lib', 'session'));

async function main() {
  const bot = new BrowserAutomation('ws://localhost:18080', {
    logger: { info: () => {}, warn: () => {}, error: console.error }
  });
  await bot.connect();
  const session = new Session({
    opts: {
      page: 'search',
      bot,
      targetUrl: 'https://x.com/search?q=AI+agent&src=typed_query',
      verbose: true,
      reuseAnyXTab: true,
      navigateOnReuse: true,
      createIfMissing: true,
    },
  });
  try {
    await session.connect();
    await session.resolveTarget();
    await session.ensureBridge();
    console.log('--- probe ---');
    const probe = await session.callApi('probe');
    console.log(JSON.stringify(probe, null, 2));
    console.log('--- state ---');
    const state = await session.callApi('state');
    console.log(JSON.stringify(state, null, 2));
    console.log('--- search ---');
    const resp = await session.callApi('search', [{ keyword: 'AI agent', sort: 'top', maxPages: 1 }], { timeoutMs: 90000 });
    console.log('  ok:', resp.ok);
    if (resp.ok) {
      console.log('  total:', resp.data.total);
      console.log('  pages:', JSON.stringify(resp.data.pages, null, 2));
      console.log('  meta:', JSON.stringify(resp.data.meta, null, 2));
      console.log('  fullQuery:', resp.data.fullQuery);
      console.log('  tweets[0]:', resp.data.tweets[0] ? JSON.stringify(resp.data.tweets[0], null, 2).slice(0, 500) : '(empty)');
    } else {
      console.log('  error:', resp.error);
      console.log('  detail:', JSON.stringify(resp).slice(0, 600));
    }
  } finally {
    await session.close();
    bot.disconnect();
  }
}
main().catch(err => { console.error('ERR:', err.message, err.stack); process.exit(1); });
