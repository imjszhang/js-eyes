'use strict';

const { Session } = require('./session');

/**
 * scrapeViaBridge - 通过 bridge JSON 主路径抓取 Reddit 帖子，
 * 输出与 lib/redditUtils.js::scrapeRedditPost 字段级一致的结构。
 *
 * 调用方负责传入已构造（不必已 connect）的 BrowserAutomation 实例。
 * 出错时抛 Error，code/detail 写在 err 上，方便上层决定回退。
 *
 * @param {object} browser - BrowserAutomation 实例
 * @param {string} url - 目标 Reddit 帖子 URL
 * @param {object} [options]
 * @param {number} [options.depth] - 评论深度
 * @param {number} [options.limit] - 评论条数上限
 * @param {string} [options.sort] - 评论排序
 * @param {boolean} [options.verbose] - bridge 日志输出到 stderr
 * @returns {Promise<{platform:'reddit', sourceUrl:string, timestamp:string, data:object, metrics:object, debug:object}>}
 */
async function scrapeViaBridge(browser, url, options = {}) {
  const start = Date.now();
  const session = new Session({
    opts: {
      page: 'post',
      bot: browser,
      targetUrl: url,
      verbose: !!options.verbose,
      createIfMissing: options.createIfMissing !== false,
    },
  });
  let resp;
  try {
    await session.connect();
    await session.resolveTarget();
    await session.ensureBridge();
    const args = [{
      url,
      depth: options.depth || null,
      limit: options.limit || null,
      sort: options.sort || null,
    }];
    resp = await session.callApi('getPost', args, {
      timeoutMs: options.timeoutMs || 90000,
    });
  } finally {
    await session.close();
  }

  if (!resp || resp.ok !== true) {
    const err = new Error(
      `bridge getPost 失败: ${resp && resp.error ? resp.error : 'unknown'}`,
    );
    err.code = 'BRIDGE_RETURN_NOT_OK';
    err.detail = resp;
    throw err;
  }

  const payload = resp.data && typeof resp.data === 'object' ? resp.data : {};
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
  const durationMs = Date.now() - start;

  return {
    platform: 'reddit',
    sourceUrl: url,
    timestamp: new Date().toISOString(),
    data,
    metrics: {
      beforePrepare: null,
      afterPrepare: null,
      preparePasses: [],
      bridge: meta,
      bridgeDurationMs: durationMs,
    },
    debug: {
      steps: [{ stage: 'bridge_get_post', durationMs, meta }],
      domStats: [],
    },
  };
}

module.exports = { scrapeViaBridge };
