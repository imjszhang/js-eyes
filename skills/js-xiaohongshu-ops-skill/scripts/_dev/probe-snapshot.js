#!/usr/bin/env node
'use strict';

/**
 * v3.1 PR-C1 probe 快照
 *
 * 一键跑全部 probe-*.js，把每个 probe 的 stdout 解析后聚合到一份快照 JSON：
 *   tests/__snapshots__/dom/<YYYY-MM-DD>.json
 *
 * 默认行为：
 *   - 跑 probe-token / probe-note / probe-comments / probe-user / probe-search
 *   - 任何 probe 失败（缺浏览器 tab 等）只在快照里记录 error，不阻断后续
 *   - 已存在同日快照时默认覆盖；--no-overwrite 时报错退出
 *
 * 用法：
 *   node scripts/_dev/probe-snapshot.js
 *   node scripts/_dev/probe-snapshot.js --out <path> --no-overwrite
 *   node scripts/_dev/probe-snapshot.js --probes probe-note,probe-search
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROBES_DEFAULT = ['probe-token', 'probe-note', 'probe-comments', 'probe-user', 'probe-search'];

function parseArgs(argv) {
  const out = { out: null, overwrite: true, probes: PROBES_DEFAULT.slice(), pretty: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else if (a === '--no-overwrite') out.overwrite = false;
    else if (a === '--pretty') out.pretty = true;
    else if (a === '--probes') out.probes = argv[++i].split(',').filter(Boolean);
    else if (a.startsWith('--probes=')) out.probes = a.slice('--probes='.length).split(',').filter(Boolean);
  }
  return out;
}

function resolveOutPath(opts) {
  if (opts.out) return path.resolve(opts.out);
  const date = new Date().toISOString().slice(0, 10);
  return path.join(__dirname, '..', '..', 'tests', '__snapshots__', 'dom', `${date}.json`);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function runProbe(name) {
  const scriptPath = path.join(__dirname, `${name}.js`);
  if (!fs.existsSync(scriptPath)) {
    return { name, ok: false, error: 'probe_not_found', path: scriptPath };
  }
  const started = Date.now();
  const res = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const elapsedMs = Date.now() - started;
  const stdout = (res.stdout || '').trim();
  const stderr = (res.stderr || '').trim();
  let parsed = null;
  try { parsed = stdout ? JSON.parse(stdout) : null; } catch (_) { parsed = null; }
  return {
    name,
    ok: res.status === 0,
    exitCode: res.status,
    elapsedMs,
    stderrTail: stderr.slice(-400),
    data: parsed,
    rawStdoutLength: stdout.length,
  };
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const outPath = resolveOutPath(opts);
  if (fs.existsSync(outPath) && !opts.overwrite) {
    console.error(`快照已存在 (${outPath})，加 --overwrite 覆盖`);
    process.exit(2);
  }

  console.error(`[snapshot] 跑 probes: ${opts.probes.join(', ')}`);
  const results = [];
  for (const name of opts.probes) {
    process.stderr.write(`  - ${name} ... `);
    const r = runProbe(name);
    results.push(r);
    process.stderr.write(r.ok ? `ok (${r.elapsedMs}ms)\n` : `fail exit=${r.exitCode}\n`);
  }

  const okCount = results.filter((r) => r.ok).length;
  const summary = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    skillVersion: require('../../package.json').version,
    okCount,
    failCount: results.length - okCount,
    probes: results,
  };

  ensureDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, opts.pretty ? 2 : 2) + '\n', 'utf8');
  console.error(`[snapshot] 写入 ${outPath} (${okCount}/${results.length} ok)`);
  if (opts.pretty) process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  else process.stdout.write(JSON.stringify({ ok: true, outPath, okCount, failCount: results.length - okCount }) + '\n');
})().catch((err) => {
  console.error('[snapshot] 失败：', err);
  process.exit(1);
});
