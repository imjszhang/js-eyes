#!/usr/bin/env node
'use strict';

/**
 * batch-search.js（模板，X 版）
 *
 * 给一个 query 矩阵（关键词 × 排序 × 时间范围），串行跑 `node index.js search ...`，
 * 每条 query 各自存一个 JSON 文件。
 *
 * 复制使用：
 *   cp scripts/_templates/batch-search.js work_dir/x/<topic>/run-searches.js
 *   编辑 QUERIES 数组（项目名 + 同义词 + 标签 hashtag 矩阵）
 *   编辑 OUT_DIR / SUMMARY_FILE
 *   node work_dir/x/<topic>/run-searches.js
 *
 * 设计原则：
 *   - 串行（不并行），避开 X.com 限流（429 连续 3 次会暂停 5 分钟）；典型每条 query 5~30 秒
 *   - 用 lib/runCliToFile 直写 fd，绕开 spawn().stdout.pipe 的 64KB 截断
 *   - 每条 query 一个 raw/<label>.json，方便后续 aggregate 步骤去重
 *   - 每次跑完写 search-summary.json，便于回溯命中量
 *
 * 推荐目录约定（与 work_dir/x/<topic>/ 风格一致）：
 *   work_dir/x/<topic>/
 *     ├── run-searches.js   ← 本模板
 *     ├── aggregate.js      ← 你写的去重 + 过滤 + tag
 *     ├── raw/<label>.json  ← 本脚本产物
 *     └── search-summary.json
 */

const fs = require('fs');
const path = require('path');
const { runCliToFile } = require('../../lib/runCliToFile');

// ===== 必改 =====================================================
const SKILL_DIR = path.resolve(__dirname, '../../');
const OUT_DIR = path.join(__dirname, 'raw');
const SUMMARY_FILE = path.join(__dirname, 'search-summary.json');

/**
 * QUERIES：每行一条搜索。常用字段：
 *   keyword     关键词（必填）
 *   sort        top|latest|media，默认 top
 *   maxPages    翻页上限（默认 1，每页约 20 条）
 *   lang        语言 zh/en/ja/...
 *   from        指定作者（不带 @）
 *   since/until YYYY-MM-DD 区间
 *   minLikes    最低点赞过滤
 *   excludeReplies/excludeRetweets
 *   label       存盘文件名前缀（必填，唯一）
 */
const QUERIES = [
  { keyword: 'EXAMPLE_PROJECT_NAME',  sort: 'top',    maxPages: 2, label: 'top-example' },
  { keyword: '#EXAMPLE_HASHTAG',      sort: 'latest', maxPages: 1, label: 'latest-hashtag' },
  { keyword: 'EXAMPLE_CONCEPT lang:en', sort: 'top',  maxPages: 1, label: 'lang-example' },
];
// ================================================================

function buildArgs(q) {
  const args = ['search', q.keyword, '--sort', q.sort || 'top', '--max-pages', String(q.maxPages || 1)];
  if (q.lang) args.push('--lang', q.lang);
  if (q.from) args.push('--from', q.from);
  if (q.since) args.push('--since', q.since);
  if (q.until) args.push('--until', q.until);
  if (q.minLikes) args.push('--min-likes', String(q.minLikes));
  if (q.minRetweets) args.push('--min-retweets', String(q.minRetweets));
  if (q.excludeReplies) args.push('--exclude-replies');
  if (q.excludeRetweets) args.push('--exclude-retweets');
  return args;
}

async function runOne(q) {
  const out = path.join(OUT_DIR, `${q.label}.json`);
  let r;
  let n = null;
  try {
    r = await runCliToFile({ skillDir: SKILL_DIR, args: buildArgs(q), outFile: out });
  } catch (err) {
    console.log(`  [ERR ] ${q.label.padEnd(28)} ${err.message}`);
    return { label: q.label, code: -1, n: null, ms: 0, err: err.message };
  }

  try {
    const j = JSON.parse(fs.readFileSync(out, 'utf8'));
    n = j.totalResults ?? (Array.isArray(j.results) ? j.results.length : null);
  } catch (e) {
    r.stderr = (r.stderr || '') + ` parse-err:${e.message}`;
  }

  const tag = r.code === 0 ? 'OK  ' : 'FAIL';
  console.log(
    `  [${tag}] ${q.label.padEnd(28)} kw="${(q.keyword || '').slice(0, 40)}" sort=${q.sort || 'top'} pages=${q.maxPages || 1} n=${n} (${r.elapsedMs}ms, ${r.outBytes}B)`,
  );
  if (r.code !== 0 && r.stderr) console.log('    stderr:', r.stderr.split('\n')[0]);

  return { label: q.label, code: r.code, n, ms: r.elapsedMs, bytes: r.outBytes };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Running ${QUERIES.length} X searches sequentially → ${OUT_DIR}`);
  const results = [];
  for (const q of QUERIES) results.push(await runOne(q));
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(results, null, 2));
  const totalHits = results.reduce((s, r) => s + (r.n || 0), 0);
  const totalMs = results.reduce((s, r) => s + (r.ms || 0), 0);
  console.log(`done. total=${totalHits} hits, elapsed=${totalMs}ms, summary=${SUMMARY_FILE}`);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
