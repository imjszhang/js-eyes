'use strict';

/**
 * 开发脚本：对比 item API 与 DOM 解析的关键字段（需浏览器 tab + js-eyes server）。
 * Usage: node scripts/_dev/diff-item-schema.js <itemId>
 */

const { BrowserAutomation } = require('../../lib/js-eyes-client');
const { Session } = require('../../lib/session');

async function main() {
  const itemId = process.argv[2];
  if (!itemId || !/^\d+$/.test(itemId)) {
    process.stderr.write('Usage: node scripts/_dev/diff-item-schema.js <itemId>\n');
    process.exit(2);
  }
  const browser = new BrowserAutomation(process.env.JS_EYES_SERVER_URL || 'ws://localhost:18080');
  await browser.connect();
  const session = new Session({
    opts: {
      page: 'item',
      bot: browser,
      targetUrl: `https://news.ycombinator.com/item?id=${itemId}`,
      createIfMissing: true,
      reuseAnyHnTab: true,
      navigateOnReuse: false,
    },
  });
  try {
    await session.connect();
    await session.resolveTarget();
    await session.ensureBridge();
    const api = await session.callApi('api_getItem', [{ itemId: Number(itemId), depth: 2, commentLimit: 20 }]);
    const dom = await session.callApi('dom_getItem', [{ itemId: Number(itemId) }]);
    const out = {
      itemId: Number(itemId),
      apiOk: api && api.ok,
      domOk: dom && dom.ok,
      apiPostTitle: api && api.data && api.data.post && api.data.post.title,
      domPostTitle: dom && dom.data && dom.data.post && dom.data.post.title,
      apiCommentCount: api && api.data && api.data.comments && api.data.comments.length,
      domCommentCount: dom && dom.data && dom.data.comments && dom.data.comments.length,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } finally {
    await session.close();
    browser.disconnect();
  }
}

main().catch((err) => {
  process.stderr.write(String(err.message) + '\n');
  process.exit(1);
});
