#!/usr/bin/env node
'use strict';

/**
 * batch-search.js
 *
 * 业务脚本：批量跑多条搜索，串行去重输出 JSONL，方便后续 aggregate。
 *
 * 输入：
 *   - --query 多次（OR）："keyword|sort|maxPages" 三段（sort/maxPages 可省）
 *   - --file <path>，每行一个 query 三段定义（# 开头跳过）
 *   - 标准输入 stdin（每行一个）
 *
 * 输出：docs/_data/batch-search-<ts>.jsonl（每行一条 search 结果摘要）
 *
 * 用法：
 *   node scripts/batch-search.js --query "AI agent|top|2" --query "MCP|latest|1"
 *   node scripts/batch-search.js --file queries.txt --throttle-ms 1500
 *   echo -e "AI agent|top|2\\nMCP|latest|1" | node scripts/batch-search.js
 */

const fs = require('fs');
const path = require('path');
const { BrowserAutomation } = require('../lib/js-eyes-client');
const { searchTweets } = require('../lib/api');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');

function parseArgs(argv) {
  const opts = {
    queries: [],
    file: null,
    out: null,
    browserServer: null,
    recordingMode: null,
    throttleMs: 1200,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--query') opts.queries.push(argv[++i]);
    else if (a === '--file') opts.file = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--browser-server' || a === '--server') opts.browserServer = argv[++i];
    else if (a === '--recording-mode') opts.recordingMode = argv[++i];
    else if (a === '--throttle-ms') opts.throttleMs = Number(argv[++i]);
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (!a.startsWith('-')) opts.queries.push(a);
  }
  return opts;
}

function printHelp() {
  process.stdout.write([
    'batch-search.js - 批量跑多条 X 搜索',
    '',
    '用法: node scripts/batch-search.js [--query "kw|sort|maxPages"]... [--file <path>] [options]',
    '  --query "kw|sort|maxPages"  多次叠加（sort/maxPages 可省）',
    '  --file <path>               每行一条 query 三段，# 开头注释',
    '  (stdin)                     不带 --query/--file 时读取 stdin',
    '  --throttle-ms <n>           每次搜索间隔（默认 1200ms）',
    '  --out <path>                输出 JSONL（默认 docs/_data/batch-search-<ts>.jsonl）',
    '  --browser-server <ws>',
    '  --recording-mode <m>        off|history|standard|debug',
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

function parseQueryList(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
}

function parseQuerySpec(spec) {
  const [keyword, sort, maxPages] = String(spec).split('|').map((s) => s.trim());
  return {
    keyword,
    sort: sort || 'top',
    maxPages: Number(maxPages) || 1,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }

  let queries = opts.queries.slice();
  if (opts.file) {
    queries = queries.concat(parseQueryList(fs.readFileSync(opts.file, 'utf8')));
  }
  if (queries.length === 0) {
    const stdin = await readStdin();
    queries = parseQueryList(stdin);
  }
  queries = queries.map(parseQuerySpec).filter((q) => q.keyword);
  if (queries.length === 0) {
    printHelp();
    process.stderr.write('ERROR: 没有任何 query 输入\n');
    process.exit(2);
  }

  const runtimeConfig = resolveRuntimeConfig({
    browserServer: opts.browserServer || process.env.JS_EYES_WS_URL,
    recording: opts.recordingMode ? { mode: opts.recordingMode } : {},
  });
  const browser = new BrowserAutomation(runtimeConfig.serverUrl);

  const outPath = opts.out || path.join(__dirname, '..', 'docs', '_data', `batch-search-${Date.now()}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const fd = fs.openSync(outPath, 'w');

  const startedAt = Date.now();
  let okCount = 0;
  let failCount = 0;

  try {
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const t0 = Date.now();
      let line;
      try {
        const data = await searchTweets(browser, q.keyword, {
          browserServer: runtimeConfig.serverUrl,
          recording: runtimeConfig.recording,
          sort: q.sort,
          maxPages: q.maxPages,
        });
        const results = (data && data.results) || [];
        line = {
          ok: true,
          keyword: q.keyword,
          sort: q.sort,
          maxPages: q.maxPages,
          totalResults: data && data.totalResults || results.length,
          firstTweetId: results[0] && results[0].tweetId || null,
          durationMs: Date.now() - t0,
        };
        okCount++;
      } catch (err) {
        line = {
          ok: false,
          keyword: q.keyword,
          sort: q.sort,
          maxPages: q.maxPages,
          error: err.message,
          durationMs: Date.now() - t0,
        };
        failCount++;
      }
      fs.writeSync(fd, JSON.stringify(line) + '\n');
      process.stderr.write(`  [${i + 1}/${queries.length}] ${line.ok ? 'OK ' : 'ERR'} kw="${q.keyword}" sort=${q.sort} n=${line.totalResults || 0} (${line.durationMs}ms)\n`);
      if (i + 1 < queries.length && opts.throttleMs > 0) {
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
