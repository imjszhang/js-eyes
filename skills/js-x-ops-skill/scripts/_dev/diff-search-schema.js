#!/usr/bin/env node
'use strict';

/**
 * scripts/_dev/diff-search-schema.js
 *
 * PR 2 验收脚本：对同一 keyword 跑「bridge 主路径」与「老 fallback 路径（JS_X_DISABLE_BRIDGE=1）」两套实现，
 * 比对 results 字段级一致性。
 *
 * 用法：
 *   node scripts/_dev/diff-search-schema.js <keyword> [--server ws://localhost:18080] [--max-pages 1] [--sort top]
 *
 * 退出码：
 *   0 - schema 一致
 *   1 - schema 有 mismatch
 *   2 - 参数错误或调用失败
 */

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { BrowserAutomation } = require(path.join(ROOT, 'lib', 'js-eyes-client'));
const { searchTweets } = require(path.join(ROOT, 'lib', 'api'));

const SCALAR_FIELDS = ['tweetId', 'content', 'publishTime', 'tweetUrl'];
const STATS_FIELDS = ['likes', 'retweets', 'replies', 'views', 'bookmarks'];
const AUTHOR_FIELDS = ['name', 'username', 'avatarUrl'];

function typeOf(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function diffOne(a, b, prefix) {
  const issues = [];
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) {
    issues.push({ path: prefix || '$', kind: 'type', a: ta, b: tb });
    return issues;
  }
  if (ta === 'object') {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) {
      if (k.startsWith('_')) continue;
      issues.push(...diffOne((a || {})[k], (b || {})[k], prefix ? `${prefix}.${k}` : k));
    }
    return issues;
  }
  if (ta === 'array') {
    const len = Math.min((a || []).length, (b || []).length, 3);
    for (let i = 0; i < len; i += 1) {
      issues.push(...diffOne(a[i], b[i], `${prefix}[${i}]`));
    }
  }
  return issues;
}

function summarize(name, response) {
  const out = {
    name,
    totalResults: response && response.totalResults || 0,
    metrics: response && response.metrics || null,
  };
  const sample = response && response.results && response.results[0];
  if (sample) {
    out.sample = {};
    for (const f of SCALAR_FIELDS) {
      out.sample[f] = typeof sample[f] === 'string' ? sample[f].slice(0, 80) : sample[f];
    }
    if (sample.author) {
      out.sample.author = {};
      for (const f of AUTHOR_FIELDS) out.sample.author[f] = sample.author[f];
    }
    if (sample.stats) {
      out.sample.stats = {};
      for (const f of STATS_FIELDS) out.sample.stats[f] = sample.stats[f];
    }
  }
  return out;
}

async function runSide(label, keyword, opts, useBridge) {
  const env = { ...process.env };
  if (!useBridge) env.JS_X_DISABLE_BRIDGE = '1';
  else delete env.JS_X_DISABLE_BRIDGE;
  const oldEnv = process.env.JS_X_DISABLE_BRIDGE;
  if (!useBridge) process.env.JS_X_DISABLE_BRIDGE = '1';
  else delete process.env.JS_X_DISABLE_BRIDGE;
  const bot = new BrowserAutomation(opts.server, {
    logger: { info: () => {}, warn: () => {}, error: console.error },
  });
  try {
    await bot.connect();
    const r = await searchTweets(bot, keyword, {
      sort: opts.sort, maxPages: opts.maxPages,
      recordingMode: 'off', noCache: true,
    });
    return r;
  } finally {
    try { bot.disconnect(); } catch (_) {}
    if (oldEnv === undefined) delete process.env.JS_X_DISABLE_BRIDGE;
    else process.env.JS_X_DISABLE_BRIDGE = oldEnv;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  let keyword = null;
  let server = 'ws://localhost:18080';
  let sort = 'top';
  let maxPages = 1;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server') server = argv[++i];
    else if (a === '--sort') sort = argv[++i];
    else if (a === '--max-pages') maxPages = parseInt(argv[++i], 10);
    else if (!keyword) keyword = a;
  }
  if (!keyword) {
    process.stderr.write('Usage: node scripts/_dev/diff-search-schema.js <keyword> [--server ws://...] [--max-pages 1] [--sort top]\n');
    process.exit(2);
  }
  let bridgeR = null, fallbackR = null, bridgeErr = null, fallbackErr = null;
  try { bridgeR = await runSide('bridge', keyword, { server, sort, maxPages }, true); }
  catch (e) { bridgeErr = { message: e.message, code: e.code || null }; }
  try { fallbackR = await runSide('fallback', keyword, { server, sort, maxPages }, false); }
  catch (e) { fallbackErr = { message: e.message, code: e.code || null }; }

  const sampleA = bridgeR && bridgeR.results && bridgeR.results[0];
  const sampleB = fallbackR && fallbackR.results && fallbackR.results[0];
  const issues = (sampleA && sampleB) ? diffOne(sampleA, sampleB, 'results[0]') : [];

  const out = {
    keyword,
    bridge: bridgeR ? summarize('bridge', bridgeR) : null,
    fallback: fallbackR ? summarize('fallback', fallbackR) : null,
    bridgeError: bridgeErr,
    fallbackError: fallbackErr,
    issueCount: issues.length,
    issues: issues.slice(0, 50),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  if (bridgeErr || fallbackErr) process.exit(2);
  process.exit(issues.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch(e => { process.stderr.write(`ERR: ${e.message}\n${e.stack}\n`); process.exit(2); });
}
