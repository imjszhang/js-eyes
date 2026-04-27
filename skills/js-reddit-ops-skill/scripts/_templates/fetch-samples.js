#!/usr/bin/env node
'use strict';

/**
 * fetch-samples.js（模板）
 *
 * 给一组 (label, sub, postId)，通过 Session::callRaw 在已登录 reddit tab 内
 * `fetch(...)` 拿完整评论树原始 JSON。每帖一个 sample-posts/<label>.json。
 *
 * 为什么不走 `node index.js post`？
 *   - 该 CLI 默认只取 depth/comment_limit 截断后的标准化结果，丢失原始字段
 *   - 大型帖子（top --time-range year 的 hot 帖）评论树达数百KB，CLI 可能超时
 *   - 直接 callRaw 一次拿到 reddit 原始 listing JSON，便于后续多维分析
 *
 * 复制使用：
 *   cp scripts/_templates/fetch-samples.js work_dir/reddit/<topic>/fetch-samples.js
 *   把 SAMPLES 改成你 aggregate.js 后挑出来的代表帖
 *   node work_dir/reddit/<topic>/fetch-samples.js
 *
 * 前置要求：浏览器里有任意已登录 reddit tab；CLI 端能正常连上 js-eyes server。
 *   不需要专门导航；脚本用 reuseAnyRedditTab 复用现有 tab。
 *
 * 注意：
 *   - 必须用绝对 URL（`https://www.reddit.com/...`），扩展隔离上下文没有 base origin
 *   - `?raw_json=1` 让 reddit 返回未 escape 的纯 JSON
 *   - `&limit=80&sort=top` 给出 top 80 评论；想全部用 `&limit=500`
 */

const fs = require('fs');
const path = require('path');
const { Session } = require('../../lib/session');

// ===== 必改 =====================================================
const OUT_DIR = path.join(__dirname, 'sample-posts');

/**
 * SAMPLES：每行一个目标帖子。
 *   label    存盘文件名前缀（唯一）
 *   sub      子版（不带 r/）
 *   postId   reddit post ID（不带 t3_ 前缀）
 */
const SAMPLES = [
  ['example-1', 'MachineLearning', '1eqwfo0'],
  ['example-2', 'LocalLLaMA',      '1rowp28'],
];

const COMMENT_LIMIT = 80;
const SORT = 'top';
// ================================================================

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const session = new Session({
    opts: {
      page: 'home',
      reuseAnyRedditTab: true,
      navigateOnReuse: false,
      verbose: false,
    },
  });
  await session.connect();
  await session.resolveTarget();

  for (const [label, sub, id] of SAMPLES) {
    const url = `https://www.reddit.com/r/${sub}/comments/${id}.json?limit=${COMMENT_LIMIT}&sort=${SORT}&raw_json=1`;
    const expr = `
      (async () => {
        const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
        return { status: r.status, body: await r.text() };
      })()
    `;
    try {
      const data = await session.callRaw(expr, { timeoutMs: 60000 });
      if (!data || data.status !== 200) {
        console.log(`  [HTTP ${data?.status || '?'}] ${label} sub=${sub} id=${id}`);
        continue;
      }
      const json = JSON.parse(data.body);
      const out = path.join(OUT_DIR, `${label}.json`);
      fs.writeFileSync(out, JSON.stringify(json, null, 2));
      const post = json[0]?.data?.children?.[0]?.data;
      const ncs = (json[1]?.data?.children || []).length;
      console.log(
        `  [OK  ] ${label.padEnd(22)} | ${post?.score}↑/${post?.num_comments}c | top=${ncs} | ${fs.statSync(out).size}B`,
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
