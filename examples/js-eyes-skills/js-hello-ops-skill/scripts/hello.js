'use strict';

/**
 * hello_get_title 的业务实现。
 *
 * 纯函数：接收一个 BrowserAutomation 实例 + 参数，返回结构化数据。
 * 不做文件 I/O、不 process.exit。这是 JS Eyes Skills 的业务层约定。
 */

async function getTitle(bot, params = {}) {
  const { tabId, target } = params;
  if (typeof tabId !== 'number' && !Number.isFinite(Number(tabId))) {
    throw new Error('tabId 必须是数字');
  }

  const info = await bot.getPageInfo(Number(tabId), { target });
  return {
    tabId: info.tabId ?? Number(tabId),
    title: info.title || '',
    url: info.url || '',
    status: info.status || null,
  };
}

async function main() {
  const { resolveRuntimeConfig } = require('../lib/runtimeConfig');
  const { BrowserAutomation } = require('../lib/js-eyes-client');

  const args = process.argv.slice(2);
  const positional = [];
  let target;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target' && args[i + 1]) {
      target = args[++i];
    } else if (arg === '-h' || arg === '--help') {
      console.log('用法: node index.js title <tabId> [--target <clientId|name>]');
      return;
    } else {
      positional.push(arg);
    }
  }

  const tabId = Number(positional[0]);
  if (!Number.isFinite(tabId)) {
    throw new Error('用法: node index.js title <tabId> [--target <clientId|name>]');
  }

  const { serverUrl } = resolveRuntimeConfig({});
  const bot = new BrowserAutomation(serverUrl, { logger: console });
  try {
    const result = await getTitle(bot, { tabId, target });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    try { bot.disconnect(); } catch (_) { /* best-effort */ }
  }
}

module.exports = {
  getTitle,
  main,
};

if (require.main === module) {
  main().catch((error) => {
    console.error('执行失败:', error.message);
    process.exit(1);
  });
}
