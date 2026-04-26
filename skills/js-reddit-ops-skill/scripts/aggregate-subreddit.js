#!/usr/bin/env node
'use strict';

/**
 * aggregate-subreddit.js
 *
 * 业务脚本：在某个 subreddit 上跑 list-subreddit + 逐帖跑 reddit_get_post，
 * 输出汇总到 docs/_data/subreddit-<sub>-<sort>-<timestamp>.json。
 *
 * 安全约束：
 *   - 全程只读，不调任何写接口
 *   - 评论树深度 / 数量上限可配
 *   - 仅 fetch reddit 公开 JSON 端点（与浏览器同源）
 *
 * 用法：
 *   node scripts/aggregate-subreddit.js <sub> \
 *     [--sort hot|new|top|rising] [--time-range day|week|...] \
 *     [--limit 10] [--depth 3] [--comment-limit 80] [--out <path>] [--pretty]
 */

const fs = require('fs');
const path = require('path');
const { BrowserAutomation } = require('../lib/js-eyes-client');
const { runTool } = require('../lib/runTool');
const { getPost } = require('../lib/api');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');

function parseArgs(argv) {
  const opts = { sub: null, sort: 'hot', timeRange: null, limit: 10, depth: 3, commentLimit: 80, out: null, pretty: false, browserServer: null, recordingMode: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-') && !opts.sub) { opts.sub = a; continue; }
    if (a === '--sort') opts.sort = argv[++i];
    else if (a === '--time-range') opts.timeRange = argv[++i];
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--depth') opts.depth = Number(argv[++i]);
    else if (a === '--comment-limit') opts.commentLimit = Number(argv[++i]);
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
    'aggregate-subreddit.js - 拉取某 subreddit hot/new/top N 篇 + 评论摘要',
    '',
    '用法: node scripts/aggregate-subreddit.js <sub> [options]',
    '  --sort hot|new|top|rising|controversial|best  默认 hot',
    '  --time-range hour|day|week|month|year|all    top/controversial 排序生效',
    '  --limit <n>           帖子条数（默认 10）',
    '  --depth <n>           评论深度（默认 3）',
    '  --comment-limit <n>   单帖评论数上限（默认 80）',
    '  --out <path>          输出 JSON 文件（默认 docs/_data/subreddit-<sub>-<sort>-<ts>.json）',
    '  --pretty              JSON 缩进 2 空格',
    '  --browser-server <ws> js-eyes WS endpoint',
    '  --recording-mode <m>  off|history|standard|debug',
    '',
  ].join('\n'));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.sub) { printHelp(); process.exit(opts.sub ? 0 : 2); }

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
      toolName: 'reddit_list_subreddit',
      pageKey: 'subreddit',
      method: 'listSubreddit',
      args: { sub: opts.sub, sort: opts.sort, t: opts.timeRange || undefined, limit: opts.limit },
      options: {
        wsEndpoint: runtimeConfig.serverUrl,
        recording: runtimeConfig.recording,
        navigateOnReuse: false,
        reuseAnyRedditTab: true,
      },
    });
    if (!listing.ok) {
      process.stderr.write(`list-subreddit failed: ${JSON.stringify(listing.error)}\n`);
      process.exit(1);
    }
    const list = (listing.result && listing.result.items) || [];
    process.stderr.write(`fetched listing: ${list.length} items, walking each...\n`);

    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const permalink = it.permalink;
      if (!permalink) continue;
      try {
        const detail = await getPost(browser, permalink, {
          browserServer: runtimeConfig.serverUrl,
          recording: runtimeConfig.recording,
          depth: opts.depth,
          limit: opts.commentLimit,
        });
        items.push({
          listing: it,
          detail: {
            ok: !!detail,
            title: detail && detail.title || it.title,
            author: detail && detail.author_name || it.author,
            score: detail && detail.upvote_count || String(it.score),
            commentCount: detail && detail.comment_count || String(it.numComments),
            commentsParsed: Array.isArray(detail && detail.comments) ? detail.comments.length : 0,
            sourceUrl: detail && detail.source_url || permalink,
            cacheHit: !!(detail && detail.cache && detail.cache.hit),
          },
        });
        process.stderr.write(`  [${i + 1}/${list.length}] ${it.permalink}\n`);
      } catch (err) {
        items.push({ listing: it, detail: { ok: false, error: err.message } });
      }
    }
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }

  const summary = {
    platform: 'reddit',
    tool: 'aggregate-subreddit',
    sub: opts.sub,
    sort: opts.sort,
    timeRange: opts.timeRange || null,
    requestedLimit: opts.limit,
    receivedCount: items.length,
    durationMs: Date.now() - startedAt,
    listing: listing && listing.result ? { meta: listing.result.meta || null } : null,
    items,
    timestamp: new Date().toISOString(),
  };

  const outPath = opts.out || path.join(__dirname, '..', 'docs', '_data', `subreddit-${opts.sub}-${opts.sort}-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, opts.pretty ? 2 : 0));
  process.stdout.write(`wrote ${outPath} (${items.length} items)\n`);
}

if (require.main === module) {
  main().catch((err) => { process.stderr.write(`ERROR: ${err.message}\n`); process.exit(1); });
}

module.exports = { main, parseArgs };
