#!/usr/bin/env node
'use strict';

/**
 * scripts/_dev/diff-post-schema.js
 *
 * M1 验收脚本：对同一 reddit URL 跑「bridge 主路径」与「DOM 兜底（cheerio）」两套实现，
 * 比对 data schema 字段级一致性，并打印两侧 metrics 摘要。
 *
 * 用法：
 *   node scripts/_dev/diff-post-schema.js <reddit-url> [--server ws://localhost:18080]
 *
 * 退出码：
 *   0 - schema 一致
 *   1 - schema 有 mismatch
 *   2 - 参数错误或调用失败
 */

const { BrowserAutomation } = require('../../lib/js-eyes-client');
const { scrapeRedditPost } = require('../../lib/redditUtils');
const { scrapeViaBridge } = require('../../lib/bridgeAdapter');
const { resolveRuntimeConfig } = require('../../lib/runtimeConfig');

const SCALAR_FIELDS = [
  'title',
  'content',
  'author_name',
  'author_id',
  'publish_time',
  'upvote_count',
  'comment_count',
  'subreddit_name',
  'subreddit_url',
  'source_url',
];

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function diffShape(a, b, prefix) {
  const issues = [];
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) {
    issues.push({ path: prefix || '$', kind: 'type', a: ta, b: tb });
    return issues;
  }
  if (ta === 'array') {
    const len = Math.max(a.length, b.length);
    const sampleLen = Math.min(len, 3);
    for (let i = 0; i < sampleLen; i += 1) {
      issues.push(...diffShape(a[i], b[i], `${prefix}[${i}]`));
    }
    if (a.length !== b.length) {
      issues.push({ path: prefix, kind: 'array-length', a: a.length, b: b.length });
    }
    return issues;
  }
  if (ta === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (k.startsWith('_')) continue;
      const next = prefix ? `${prefix}.${k}` : k;
      issues.push(...diffShape(a[k], b[k], next));
    }
    return issues;
  }
  return issues;
}

function summarize(name, result) {
  const data = result && result.data ? result.data : {};
  const out = { name, durationMs: result && result.metrics ? result.metrics.bridgeDurationMs || null : null };
  for (const f of SCALAR_FIELDS) {
    out[f] = typeof data[f] === 'string' ? (data[f].length > 80 ? data[f].slice(0, 77) + '...' : data[f]) : data[f];
  }
  out.image_count = Array.isArray(data.image_urls) ? data.image_urls.length : null;
  out.top_level = Array.isArray(data.comments) ? data.comments.length : null;
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  let url = null;
  let serverUrl = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--server' || a === '--ws-endpoint' || a === '--browser-server') serverUrl = args[++i];
    else if (a.startsWith('--server=') || a.startsWith('--ws-endpoint=') || a.startsWith('--browser-server=')) {
      serverUrl = a.slice(a.indexOf('=') + 1);
    } else if (!url) url = a;
  }
  if (!url) {
    process.stderr.write('用法: node scripts/_dev/diff-post-schema.js <reddit-url> [--server ws://...]\n');
    process.exit(2);
  }
  const cfg = resolveRuntimeConfig({ browserServer: serverUrl });
  const browser = new BrowserAutomation(cfg.serverUrl, {
    logger: { info: () => {}, warn: (...a) => console.error(...a), error: (...a) => console.error(...a) },
  });

  let bridgeResult = null;
  let domResult = null;
  let bridgeError = null;
  let domError = null;

  try {
    try { bridgeResult = await scrapeViaBridge(browser, url, {}); }
    catch (err) { bridgeError = { message: err.message, code: err.code || null, detail: err.detail || null }; }

    try { domResult = await scrapeRedditPost(browser, url, {}); }
    catch (err) { domError = { message: err.message, code: err.code || null }; }
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }

  const issues = (bridgeResult && domResult)
    ? diffShape(bridgeResult.data, domResult.data, '')
    : [];

  const out = {
    url,
    bridge: bridgeResult ? summarize('bridge', bridgeResult) : null,
    dom: domResult ? summarize('dom', domResult) : null,
    bridgeError,
    domError,
    issueCount: issues.length,
    issues: issues.slice(0, 50),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  if (bridgeError || domError) process.exit(2);
  process.exit(issues.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(2);
  });
}

module.exports = { diffShape, summarize };
