#!/usr/bin/env node
'use strict';

/**
 * fetch-samples.js（模板，X 版）
 *
 * 给一组 (label, tweetId)，复用已登录 X tab，调 post-bridge 的 getPost 拉
 * 完整推文+串推+回复结构。每条样本一个 sample-posts/<label>.json。
 *
 * 为什么不走 `node index.js post`？
 *   - 可以共享同一个 Session（一次性建立 ws + 注入 bridge），N 条样本翻几秒
 *   - 不会每条都 spawn 一个 node 进程
 *   - 直接拿 bridge 的结构化输出，不丢字段
 *
 * 复制使用：
 *   cp scripts/_templates/fetch-samples.js work_dir/x/<topic>/fetch-samples.js
 *   把 SAMPLES 改成 aggregate 后挑出来的代表推
 *   node work_dir/x/<topic>/fetch-samples.js
 *
 * 前置要求：浏览器里有任意已登录 X tab；CLI 端能正常连上 js-eyes server。
 *   不需要专门导航；脚本用 reuseAnyXTab 复用现有 tab。
 *
 * 注意：
 *   - X.com GraphQL TweetDetail 限流较严，建议 SAMPLES <= 30
 *   - 同一 Session 内串行调，避免触发 429（429 连续 3 次 bridge 会暂停 5 分钟）
 */

const fs = require('fs');
const path = require('path');
const { Session } = require('../../lib/session');

// ===== 必改 =====================================================
const OUT_DIR = path.join(__dirname, 'sample-posts');

/**
 * SAMPLES：每行一个目标推文。
 *   label    存盘文件名前缀（唯一）
 *   tweetId  X status id（不带 t1_/前缀）
 */
const SAMPLES = [
  ['example-1', '1234567890123456789'],
  ['example-2', '1234567890123456790'],
];

const WITH_THREAD = true;
const WITH_REPLIES = true;
// ================================================================

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const session = new Session({
    opts: {
      page: 'home',
      reuseAnyXTab: true,
      navigateOnReuse: false,
      verbose: false,
    },
  });
  await session.connect();
  await session.resolveTarget();
  await session.ensureBridge();

  for (const [label, tweetId] of SAMPLES) {
    try {
      const resp = await session.callApi(
        'getPost',
        [{ tweetId, withThread: WITH_THREAD, withReplies: WITH_REPLIES }],
        { timeoutMs: 60000 },
      );
      if (!resp || resp.ok !== true) {
        console.log(`  [FAIL] ${label.padEnd(22)} id=${tweetId} ${(resp && resp.error) || 'unknown'}`);
        continue;
      }
      const out = path.join(OUT_DIR, `${label}.json`);
      fs.writeFileSync(out, JSON.stringify(resp.data, null, 2));
      const tweet = resp.data && resp.data.tweet;
      const replies = (resp.data && resp.data.replies) ? resp.data.replies.length : 0;
      const stats = (tweet && tweet.stats) || {};
      console.log(
        `  [OK  ] ${label.padEnd(22)} | ❤${stats.likes ?? '?'}/🔁${stats.retweets ?? '?'}/💬${stats.replies ?? '?'} | replies=${replies} | ${fs.statSync(out).size}B`,
      );
    } catch (e) {
      console.log(`  [FAIL] ${label}: ${e.message}`);
    }
  }
  await session.close();
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
