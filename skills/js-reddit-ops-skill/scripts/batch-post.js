#!/usr/bin/env node
'use strict';

/**
 * batch-post.js
 *
 * 业务脚本：按 URL 列表批量拉帖子详情。
 *
 * 输入：
 *   - 命令行 --url 多次（OR）
 *   - --file <path>，每行一个 URL（# 开头跳过）
 *   - 标准输入 stdin（每行一个）
 *
 * 输出：docs/_data/batch-post-<ts>.jsonl（每行一个 result + meta）
 *
 * 用法：
 *   node scripts/batch-post.js --file urls.txt --depth 3 --comment-limit 50
 *   cat urls.txt | node scripts/batch-post.js --depth 4
 */

const fs = require('fs');
const path = require('path');
const { BrowserAutomation } = require('../lib/js-eyes-client');
const { getPost } = require('../lib/api');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');

function parseArgs(argv) {
  const opts = { urls: [], file: null, depth: 3, commentLimit: 80, out: null, browserServer: null, recordingMode: null, throttleMs: 800 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') opts.urls.push(argv[++i]);
    else if (a === '--file') opts.file = argv[++i];
    else if (a === '--depth') opts.depth = Number(argv[++i]);
    else if (a === '--comment-limit') opts.commentLimit = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--browser-server' || a === '--server') opts.browserServer = argv[++i];
    else if (a === '--recording-mode') opts.recordingMode = argv[++i];
    else if (a === '--throttle-ms') opts.throttleMs = Number(argv[++i]);
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (!a.startsWith('-')) opts.urls.push(a);
  }
  return opts;
}

function printHelp() {
  process.stdout.write([
    'batch-post.js - 按 URL 列表批量拉帖子详情',
    '',
    '用法: node scripts/batch-post.js [--url <url>]... [--file <path>] [options]',
    '  --url <url>          多次叠加（OR）',
    '  --file <path>        每行一个 URL，# 开头注释',
    '  (stdin)              不带 --url/--file 时读取 stdin',
    '  --depth <n>          评论深度（默认 3）',
    '  --comment-limit <n>  评论数上限（默认 80）',
    '  --throttle-ms <n>    每次请求间隔（默认 800ms）',
    '  --out <path>         输出 JSONL（默认 docs/_data/batch-post-<ts>.jsonl）',
    '  --browser-server <ws>',
    '  --recording-mode <m> off|history|standard|debug',
    '',
  ].join('\n'));
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

function parseUrlList(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }

  let urls = opts.urls.slice();
  if (opts.file) {
    urls = urls.concat(parseUrlList(fs.readFileSync(opts.file, 'utf8')));
  }
  if (urls.length === 0) {
    const stdin = await readStdin();
    urls = parseUrlList(stdin);
  }
  urls = Array.from(new Set(urls));
  if (urls.length === 0) {
    printHelp();
    process.stderr.write('ERROR: 没有任何 URL 输入\n');
    process.exit(2);
  }

  const runtimeConfig = resolveRuntimeConfig({
    browserServer: opts.browserServer || process.env.JS_EYES_WS_URL,
    recording: opts.recordingMode ? { mode: opts.recordingMode } : {},
  });
  const browser = new BrowserAutomation(runtimeConfig.serverUrl);

  const outPath = opts.out || path.join(__dirname, '..', 'docs', '_data', `batch-post-${Date.now()}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const fd = fs.openSync(outPath, 'w');

  const startedAt = Date.now();
  let okCount = 0;
  let failCount = 0;

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      let line;
      const t0 = Date.now();
      try {
        const detail = await getPost(browser, url, {
          browserServer: runtimeConfig.serverUrl,
          recording: runtimeConfig.recording,
          depth: opts.depth,
          limit: opts.commentLimit,
        });
        line = {
          ok: true,
          url,
          title: detail && detail.title || '',
          author: detail && detail.author_name || '',
          score: detail && detail.upvote_count || '',
          commentCount: detail && detail.comment_count || '',
          commentsParsed: Array.isArray(detail && detail.comments) ? detail.comments.length : 0,
          subreddit: detail && detail.subreddit_name || '',
          cacheHit: !!(detail && detail.cache && detail.cache.hit),
          durationMs: Date.now() - t0,
        };
        okCount++;
      } catch (err) {
        line = { ok: false, url, error: err.message, durationMs: Date.now() - t0 };
        failCount++;
      }
      fs.writeSync(fd, JSON.stringify(line) + '\n');
      process.stderr.write(`  [${i + 1}/${urls.length}] ${line.ok ? 'OK ' : 'ERR'} ${url}${line.cacheHit ? ' (cache)' : ''}\n`);
      if (i + 1 < urls.length && opts.throttleMs > 0) {
        await new Promise((r) => setTimeout(r, opts.throttleMs));
      }
    }
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
    try { browser.disconnect(); } catch (_) {}
  }

  process.stdout.write(`wrote ${outPath} ok=${okCount} fail=${failCount} elapsed=${Date.now() - startedAt}ms\n`);
}

if (require.main === module) {
  main().catch((err) => { process.stderr.write(`ERROR: ${err.message}\n`); process.exit(1); });
}

module.exports = { main, parseArgs };
