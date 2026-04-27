#!/usr/bin/env node
'use strict';

/**
 * aggregate-profile.js
 *
 * 业务脚本：在某个 X 用户主页上跑 x_get_profile 拉前 N 条推，再逐条
 * x_get_post 取完整字段+回复，输出汇总到 docs/_data/profile-<user>-<ts>.json。
 *
 * 安全约束：
 *   - 全程只读，不调任何写接口
 *   - 共用一个 Session/bridge，避免重复 ws 连接
 *   - 默认 limit=20，避免触发 X 限流（429 连续 3 次会暂停 5 分钟）
 *
 * 用法：
 *   node scripts/aggregate-profile.js <username> [options]
 *     --limit <n>            主页拉多少条（默认 20）
 *     --include-replies      包含回复推文（默认否）
 *     --max-pages <n>        getProfile 翻页上限（默认 1）
 *     --with-replies         逐条 getPost 时同时取回复（默认否）
 *     --throttle-ms <n>      逐条 getPost 间隔（默认 600ms）
 *     --out <path>           输出 JSON 路径
 *     --pretty               JSON 缩进 2 空格
 *     --browser-server <ws>  js-eyes WS endpoint
 *     --recording-mode <m>   off|history|standard|debug
 */

const fs = require('fs');
const path = require('path');
const { BrowserAutomation } = require('../lib/js-eyes-client');
const { runTool } = require('../lib/runTool');
const { getPost } = require('../lib/api');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');

function parseArgs(argv) {
  const opts = {
    username: null,
    limit: 20,
    includeReplies: false,
    maxPages: 1,
    withReplies: false,
    throttleMs: 600,
    out: null,
    pretty: false,
    browserServer: null,
    recordingMode: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-') && !opts.username) { opts.username = a.replace(/^@/, ''); continue; }
    if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--include-replies') opts.includeReplies = true;
    else if (a === '--max-pages') opts.maxPages = Number(argv[++i]);
    else if (a === '--with-replies') opts.withReplies = true;
    else if (a === '--throttle-ms') opts.throttleMs = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--pretty') opts.pretty = true;
    else if (a === '--browser-server' || a === '--server') opts.browserServer = argv[++i];
    else if (a === '--recording-mode') opts.recordingMode = argv[++i];
    else if (a === '-h' || a === '--help') opts.help = true;
  }
  return opts;
}

function printHelp() {
  process.stdout.write([
    'aggregate-profile.js - 拉某用户主页 N 条 + 逐条详情',
    '',
    '用法: node scripts/aggregate-profile.js <username> [options]',
    '  --limit <n>            主页拉多少条（默认 20）',
    '  --include-replies      包含回复推文',
    '  --max-pages <n>        getProfile 翻页上限（默认 1）',
    '  --with-replies         逐条 getPost 时同时取回复',
    '  --throttle-ms <n>      逐条 getPost 间隔（默认 600ms）',
    '  --out <path>           输出 JSON',
    '  --pretty               JSON 缩进 2 空格',
    '  --browser-server <ws>',
    '  --recording-mode <m>   off|history|standard|debug',
    '',
  ].join('\n'));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.username) { printHelp(); process.exit(opts.username ? 0 : 2); }

  const runtimeConfig = resolveRuntimeConfig({
    browserServer: opts.browserServer || process.env.JS_EYES_WS_URL,
    recording: opts.recordingMode ? { mode: opts.recordingMode } : {},
  });
  const browser = new BrowserAutomation(runtimeConfig.serverUrl);

  const startedAt = Date.now();
  const items = [];
  let listing;
  try {
    listing = await runTool(browser, {
      toolName: 'x_get_profile',
      pageKey: 'profile',
      method: 'getProfile',
      args: {
        username: opts.username,
        limit: opts.limit,
        maxPages: opts.maxPages,
        includeReplies: opts.includeReplies,
      },
      targetUrl: `https://x.com/${opts.username}`,
      options: {
        wsEndpoint: runtimeConfig.serverUrl,
        recording: runtimeConfig.recording,
        navigateOnReuse: true,
        reuseAnyXTab: true,
      },
    });
    if (!listing.ok) {
      process.stderr.write(`x_get_profile failed: ${JSON.stringify(listing.error)}\n`);
      process.exit(1);
    }
    const list = (listing.result && (listing.result.results || listing.result.tweets)) || [];
    process.stderr.write(`fetched profile: ${list.length} tweets, walking each...\n`);

    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const tweetId = it.tweetId || it.id_str || it.id;
      if (!tweetId) continue;
      const t0 = Date.now();
      try {
        const resp = await getPost(browser, tweetId, {
          browserServer: runtimeConfig.serverUrl,
          recording: runtimeConfig.recording,
          withThread: true,
          withReplies: !!opts.withReplies,
        });
        const tweet = resp && Array.isArray(resp.tweets) ? resp.tweets[0] : null;
        items.push({
          listing: it,
          detail: {
            ok: !!tweet,
            tweetId: (tweet && tweet.tweetId) || tweetId,
            author: (tweet && tweet.author && tweet.author.screenName) || (it.author && it.author.screenName),
            stats: (tweet && tweet.stats) || it.stats || null,
            createdAt: (tweet && tweet.createdAt) || it.createdAt,
            repliesParsed: Array.isArray(tweet && tweet.replies) ? tweet.replies.length : 0,
            sourceUrl: (tweet && tweet.url) || `https://x.com/${opts.username}/status/${tweetId}`,
            cacheHit: !!(resp && resp.cache && resp.cache.hit),
          },
        });
        process.stderr.write(`  [${i + 1}/${list.length}] ${tweetId} (${Date.now() - t0}ms)\n`);
      } catch (err) {
        items.push({ listing: it, detail: { ok: false, error: err.message } });
      }
      if (i + 1 < list.length && opts.throttleMs > 0) {
        await new Promise((r) => setTimeout(r, opts.throttleMs));
      }
    }
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }

  const summary = {
    platform: 'x',
    tool: 'aggregate-profile',
    username: opts.username,
    requestedLimit: opts.limit,
    includeReplies: opts.includeReplies,
    receivedCount: items.length,
    durationMs: Date.now() - startedAt,
    profile: listing && listing.result ? { meta: listing.result.profile || listing.result.user || null } : null,
    items,
    timestamp: new Date().toISOString(),
  };

  const outPath = opts.out || path.join(__dirname, '..', 'docs', '_data', `profile-${opts.username}-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, opts.pretty ? 2 : 0));
  process.stdout.write(`wrote ${outPath} (${items.length} items)\n`);
}

if (require.main === module) {
  main().catch((err) => { process.stderr.write(`ERROR: ${err.message}\n`); process.exit(1); });
}

module.exports = { main, parseArgs };
