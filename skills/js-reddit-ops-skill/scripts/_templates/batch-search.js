#!/usr/bin/env node
'use strict';

/**
 * batch-search.js（模板）
 *
 * 给一个 query 矩阵，串行跑 `node index.js search ...`，结果各自存一个 JSON 文件。
 *
 * 复制使用：
 *   cp scripts/_templates/batch-search.js work_dir/reddit/<topic>/run-searches.js
 *   编辑 QUERIES 数组（项目名 + 关键词，子版 + 全站交叉）
 *   编辑 OUT_DIR / SUMMARY_FILE
 *   node work_dir/reddit/<topic>/run-searches.js
 *
 * 设计原则：
 *   - 串行（不并行），避免 reddit 限流；典型每个 query 1~25 秒
 *   - 用 lib/runCliToFile 直写 fd，绕开 spawn().stdout.pipe 的 64KB 截断
 *   - 每个 query 一个 raw/<label>.json，方便后续 aggregate 步骤去重
 *   - 每次跑完写 search-summary.json，便于回溯命中量
 *
 * 推荐目录约定（与 work_dir/reddit/<topic>/ 风格一致）：
 *   work_dir/reddit/<topic>/
 *     ├── run-searches.js   ← 本模板
 *     ├── aggregate.js      ← 你写的去重 + 过滤 + tag
 *     ├── raw/<label>.json  ← 本脚本产物
 *     └── search-summary.json
 */

const fs = require('fs');
const path = require('path');
const { runCliToFile } = require('../../lib/runCliToFile');

// ===== 必改 =====================================================
const SKILL_DIR = path.resolve(__dirname, '../../');                    // 默认指向 skill 根
const OUT_DIR = path.join(__dirname, 'raw');                            // 复制脚本到 work_dir 后，这里就是 work_dir/reddit/<topic>/raw
const SUMMARY_FILE = path.join(__dirname, 'search-summary.json');

/**
 * QUERIES：每行一个查询。常用字段：
 *   q          搜索词（必填）
 *   sub        子版限制（不填则全站）
 *   sort       hot|new|top|relevance|comments，默认 top
 *   range      hour|day|week|month|year|all，默认 all
 *   type       link|sr|user，默认 link
 *   limit      1..100，默认 50
 *   label      存盘文件名前缀（必填，唯一）
 */
const QUERIES = [
  { q: 'EXAMPLE PROJECT NAME', sub: 'MachineLearning', range: 'year', label: 'ml-example' },
  { q: 'EXAMPLE CONCEPT',      sub: 'LocalLLaMA',      range: 'year', label: 'lll-example' },
  { q: 'EXAMPLE BROAD',        sub: '',                range: 'all',  label: 'all-example' },
];
// ================================================================

function buildArgs(q) {
  const args = [
    'search',
    q.q,
    '--search-type', q.type || 'link',
    '--sort', q.sort || 'top',
    '--time-range', q.range || 'all',
    '--limit', String(q.limit || 50),
  ];
  if (q.sub) args.push('--sub', q.sub);
  return args;
}

async function runOne(q) {
  const out = path.join(OUT_DIR, `${q.label}.json`);
  let r, n = null;
  try {
    r = await runCliToFile({ skillDir: SKILL_DIR, args: buildArgs(q), outFile: out });
  } catch (err) {
    console.log(`  [ERR ] ${q.label.padEnd(28)} ${err.message}`);
    return { label: q.label, code: -1, n: null, ms: 0, err: err.message };
  }

  try {
    const j = JSON.parse(fs.readFileSync(out, 'utf8'));
    n = j.result?.returnedCount ?? j.result?.items?.length ?? null;
  } catch (e) {
    r.stderr = (r.stderr || '') + ` parse-err:${e.message}`;
  }

  const tag = r.code === 0 ? 'OK  ' : 'FAIL';
  console.log(
    `  [${tag}] ${q.label.padEnd(28)} q="${q.q.slice(0, 40)}" sub=${q.sub || '(all)'} range=${q.range || 'all'} n=${n} (${r.elapsedMs}ms, ${r.outBytes}B)`,
  );
  if (r.code !== 0 && r.stderr) console.log('    stderr:', r.stderr.split('\n')[0]);

  return { label: q.label, code: r.code, n, ms: r.elapsedMs, bytes: r.outBytes };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Running ${QUERIES.length} searches sequentially → ${OUT_DIR}`);
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
