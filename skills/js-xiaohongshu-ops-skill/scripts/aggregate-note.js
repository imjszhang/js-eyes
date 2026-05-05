#!/usr/bin/env node
'use strict';

/**
 * v3.1 PR-C2 aggregate-note 流水线
 *
 * 把 skill 从「工具」升级为「采集流水线」：
 *   --user <id>     →  xhs_get_user_notes 拿 list  →  逐条 navigate-note + xhs_get_note  →  JSONL
 *   --keyword <kw>  →  xhs_search_notes 拿 list    →  逐条 navigate-note + xhs_get_note  →  JSONL
 *
 * 共享 lib/rateLimit/limiter.js 的 getSharedLimiter（与 runTool 共享一个 Node 端节流器）。
 *
 * 输出：
 *   ~/.js-eyes/skill-data/js-xiaohongshu-ops-skill/aggregates/<target>-<YYYYMMDD-HHmm>.jsonl
 *
 * 用法：
 *   node scripts/aggregate-note.js --user <userId> --limit 30
 *   node scripts/aggregate-note.js --keyword "穿搭" --limit 20 --with-comments
 *   node scripts/aggregate-note.js --user <userId> --limit 30 --out custom.jsonl --dry-run
 */

const fs = require('fs');
const path = require('path');
const { BrowserAutomation } = require('../lib/js-eyes-client');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');
const { runTool } = require('../lib/runTool');
const { getSharedLimiter } = require('../lib/rateLimit/limiter');
const { getSkillRecordPaths } = require('@js-eyes/runtime-paths');
const pkg = require('../package.json');
const { COMMANDS } = require('../lib/commands');

function parseArgs(argv) {
  const out = {
    user: null,
    keyword: null,
    limit: 20,
    withComments: false,
    maxCommentPages: 1,
    out: null,
    dryRun: false,
    verbose: false,
    pretty: false,
    minIntervalMs: 1500,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = (k) => { out[k] = argv[++i]; };
    if (a === '--user') eat('user');
    else if (a.startsWith('--user=')) out.user = a.slice('--user='.length);
    else if (a === '--keyword') eat('keyword');
    else if (a.startsWith('--keyword=')) out.keyword = a.slice('--keyword='.length);
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice('--limit='.length));
    else if (a === '--with-comments') out.withComments = true;
    else if (a === '--max-comment-pages') out.maxCommentPages = Number(argv[++i]);
    else if (a === '--out') eat('out');
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--pretty') out.pretty = true;
    else if (a === '--min-interval-ms') out.minIntervalMs = Number(argv[++i]);
  }
  if (!out.user && !out.keyword) {
    console.error('用法: aggregate-note.js --user <userId> | --keyword <kw> [--limit N] [--with-comments]');
    process.exit(2);
  }
  if (out.user && out.keyword) {
    console.error('--user 与 --keyword 互斥');
    process.exit(2);
  }
  if (!out.limit || out.limit <= 0) out.limit = 20;
  return out;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function resolveOutPath(opts) {
  if (opts.out) return path.resolve(opts.out);
  const paths = getSkillRecordPaths(pkg.name);
  const aggDir = path.join(paths.skillDir, 'aggregates');
  fs.mkdirSync(aggDir, { recursive: true });
  const target = opts.user ? `user-${opts.user}` : `search-${(opts.keyword || '').replace(/[^\w\u4e00-\u9fa5]+/g, '_').slice(0, 40)}`;
  return path.join(aggDir, `${target}-${timestamp()}.jsonl`);
}

async function fetchList(browser, opts, runtime) {
  if (opts.user) {
    const cmdDef = COMMANDS['user-notes'];
    return runTool(browser, {
      toolName: cmdDef.toolName,
      pageKey: 'user',
      method: cmdDef.api,
      cmdDef: cmdDef.cmdDef,
      args: { userId: opts.user, maxPages: Math.max(1, Math.ceil(opts.limit / 20)) },
      targetUrl: `https://www.xiaohongshu.com/user/profile/${opts.user}`,
      options: {
        wsEndpoint: runtime.serverUrl, recording: runtime.recording,
        verbose: opts.verbose, navigateOnReuse: false, reuseAnyXhsTab: true,
        timeoutMs: 90000, rateLimit: true,
        minIntervalMs: opts.minIntervalMs,
      },
    });
  }
  const cmdDef = COMMANDS.search;
  return runTool(browser, {
    toolName: cmdDef.toolName,
    pageKey: 'search',
    method: cmdDef.api,
    cmdDef: cmdDef.cmdDef,
    args: { keyword: opts.keyword, limit: opts.limit },
    targetUrl: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(opts.keyword)}`,
    options: {
      wsEndpoint: runtime.serverUrl, recording: runtime.recording,
      verbose: opts.verbose, navigateOnReuse: false, reuseAnyXhsTab: true,
      timeoutMs: 90000, rateLimit: true,
      minIntervalMs: opts.minIntervalMs,
    },
  });
}

function extractListItems(listResult) {
  if (!listResult || !listResult.ok || !listResult.result) return [];
  const r = listResult.result;
  const arr = r.notes || r.items || (Array.isArray(r) ? r : []);
  return arr.filter(Boolean);
}

async function fetchNote(browser, item, opts, runtime) {
  const cmdDef = COMMANDS.note;
  const noteUrl = item.url || (item.noteId
    ? `https://www.xiaohongshu.com/explore/${item.noteId}${item.xsecToken ? `?xsec_token=${encodeURIComponent(item.xsecToken)}` : ''}`
    : null);
  if (!noteUrl) return { ok: false, error: 'no_url', item };
  return runTool(browser, {
    toolName: cmdDef.toolName,
    pageKey: 'note',
    method: cmdDef.api,
    cmdDef: cmdDef.cmdDef,
    args: {
      url: noteUrl,
      withComments: !!opts.withComments,
      maxCommentPages: opts.maxCommentPages || 1,
    },
    targetUrl: noteUrl,
    options: {
      wsEndpoint: runtime.serverUrl, recording: runtime.recording,
      verbose: opts.verbose, navigateOnReuse: true, reuseAnyXhsTab: true,
      timeoutMs: 90000, rateLimit: true,
      minIntervalMs: opts.minIntervalMs,
    },
  });
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const runtime = resolveRuntimeConfig({});
  const outPath = resolveOutPath(opts);

  console.error(`[aggregate] target=${opts.user ? 'user:' + opts.user : 'search:' + opts.keyword} limit=${opts.limit} → ${outPath}`);

  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: opts.verbose ? console : { info: () => {}, warn: console.error, error: console.error },
  });

  // 共享 limiter（同一进程内 runTool 内部也用同一个）
  const limiter = getSharedLimiter({
    minIntervalMs: opts.minIntervalMs,
    maxRandomDelayMs: 800,
    maxConcurrent: 1,
  });

  const summary = {
    target: opts.user ? { type: 'user', userId: opts.user } : { type: 'search', keyword: opts.keyword },
    startedAt: new Date().toISOString(),
    listOk: false,
    listCount: 0,
    fetched: 0,
    failed: 0,
    outPath,
    errors: [],
  };

  let stream = null;
  try {
    await browser.connect();
    const listResp = await fetchList(browser, opts, runtime);
    const items = extractListItems(listResp);
    summary.listOk = !!(listResp && listResp.ok);
    summary.listCount = items.length;
    if (!summary.listOk) {
      summary.error = (listResp && listResp.error) || { code: 'list_failed' };
      console.error('[aggregate] list 抓取失败：', JSON.stringify(summary.error));
    } else {
      console.error(`[aggregate] list ok, candidates=${items.length}`);
    }

    if (!opts.dryRun) {
      stream = fs.createWriteStream(outPath, { flags: 'w', encoding: 'utf8' });
    }

    const limit = Math.min(items.length, opts.limit);
    for (let i = 0; i < limit; i++) {
      const item = items[i];
      process.stderr.write(`  [${i + 1}/${limit}] ${item.noteId || item.url || '?'} ... `);
      try {
        const noteResp = await limiter.schedule(() => fetchNote(browser, item, opts, runtime));
        const ok = !!(noteResp && noteResp.ok);
        if (ok) summary.fetched++; else summary.failed++;
        process.stderr.write(ok ? 'ok\n' : `fail (${noteResp && noteResp.error && noteResp.error.code})\n`);
        if (stream) {
          stream.write(JSON.stringify({
            target: summary.target,
            seq: i,
            listItem: item,
            note: ok ? noteResp.result : null,
            ok,
            error: ok ? null : (noteResp && noteResp.error) || null,
            antiCrawlState: noteResp && noteResp.antiCrawlState || null,
            fetchedAt: new Date().toISOString(),
          }) + '\n');
        }
        // 提前停：检测到 hard 反爬就退出
        const ac = noteResp && noteResp.antiCrawlState;
        if (ac && ac.kind === 'hard') {
          summary.errors.push({ stage: 'note', i, error: 'hard_anti_crawl', reason: ac.lastReason });
          console.error('[aggregate] hard anti-crawl detected, abort.');
          break;
        }
      } catch (err) {
        summary.failed++;
        summary.errors.push({ stage: 'note', i, error: String(err && err.message || err) });
        process.stderr.write(`error\n`);
      }
    }
  } catch (err) {
    summary.error = { code: err.code || 'fatal', message: err.message };
    console.error('[aggregate] fatal:', err.message);
  } finally {
    try { if (stream) stream.end(); } catch (_) {}
    try { browser.disconnect(); } catch (_) {}
  }

  summary.finishedAt = new Date().toISOString();
  process.stdout.write(JSON.stringify(summary, null, opts.pretty ? 2 : 0) + '\n');
  process.exit(summary.listOk ? 0 : 1);
})().catch((err) => {
  console.error('[aggregate] uncaught:', err);
  process.exit(1);
});
