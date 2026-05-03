#!/usr/bin/env node
'use strict';

// jse-template-scaffold CLI
// ---------------------------------------------------------------------------
// 读一个 visual session bundle，扫出所有 (skillId, kind) 二元组，对其中"没有
// 专属模板（命中 generic / hard-fallback / skill-wildcard 兜底）"的，自动产出
// 一份 templates/<skillId>/<kind>.js 骨架文件，方便开发者打磨样式。
//
// 用法：
//   jse-template-scaffold <session-dir> [--out <dir>] [--skill <id>] [--dry-run]
//
//   --out      生成根目录（默认 ./templates-scaffold；建议人工审过再 mv 到
//              packages/visual-replay-hyperframes/templates/<skillId>）
//   --skill    显式覆盖 meta.skillId（用于会话包没写 skill 字段的情形）
//   --dry-run  只打印将要生成的文件，不写入磁盘
//
// 设计要点：
//   1. registry 的 (sid,*) / (*,*) / (*,'global') 兜底档位会被识别为"未注册"
//   2. 字段推断只做 shallow scan：顶层 keys + items[0] keys + fields 的 k 集合
//   3. 生成的骨架以 _generic 模板的 list/kv 输出为起点（先能渲再说），TODO
//      注释列出推断字段，让作者照着补 reddit 风格的 HTML
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const { readVisualSession } = require('@js-eyes/visual-bridge-kit');

require('../templates/_generic');
require('../templates/reddit');
const { findUnknownKinds, listTemplates } = require('../templates/registry');

function parseArgs(argv){
  const opts = { sessionDir: null, out: null, skillId: null, dryRun: false, help: false, sample: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a === '--dry-run') { opts.dryRun = true; continue; }
    if (a === '--out' && argv[i + 1]) { opts.out = argv[++i]; continue; }
    if (a.startsWith('--out=')) { opts.out = a.slice('--out='.length); continue; }
    if (a === '--skill' && argv[i + 1]) { opts.skillId = argv[++i]; continue; }
    if (a.startsWith('--skill=')) { opts.skillId = a.slice('--skill='.length); continue; }
    if (a === '--sample' && argv[i + 1]) { opts.sample = parseInt(argv[++i], 10) || 3; continue; }
    if (a.startsWith('-')) { throw new Error('未知参数: ' + a); }
    if (!opts.sessionDir) { opts.sessionDir = a; continue; }
    throw new Error('多余的位置参数: ' + a);
  }
  return opts;
}

function printHelp(){
  process.stdout.write([
    'jse-template-scaffold - 从 visual session 反推未注册的 (skillId, kind)，',
    '                        生成 templates/<skillId>/<kind>.js 骨架文件。',
    '',
    'Usage:',
    '  jse-template-scaffold <session-dir> [options]',
    '',
    'Options:',
    '  --out <dir>          骨架输出根目录（默认 ./templates-scaffold）',
    '  --skill <id>         显式覆盖 meta.skillId',
    '  --sample <n>         每个 (skillId, kind) 抽样多少条 payload 推断字段（默认 3）',
    '  --dry-run            只打印将要生成的文件清单',
    '  -h, --help           显示帮助',
    '',
    'Example:',
    '  jse-template-scaffold runs/sess-001 --dry-run',
    '  jse-template-scaffold runs/sess-001 --out ./scaffold-out',
    '',
  ].join('\n'));
}

/**
 * extractKindsFromSession - 扫 entries 找出 (skillId, kind, payload) 三元组。
 * 同一 (skillId, kind) 累计 count 与 samples 数组。
 */
function extractKindsFromSession(session, overrideSkill){
  const map = new Map();
  const metaSkill = (session.meta && session.meta.skillId) || '';
  for (const entry of (session.entries || [])) {
    const skillId = overrideSkill || entry.skillId || metaSkill || '';
    const events = Array.isArray(entry.events) ? entry.events : [];
    for (const ev of events) {
      if (!ev || ev.type !== 'after') continue;
      const kind = ev.kind || 'global';
      const key = (skillId || '*') + '::' + kind;
      if (!map.has(key)) map.set(key, { skillId: skillId || '*', kind, count: 0, samples: [] });
      const slot = map.get(key);
      slot.count += 1;
      if (slot.samples.length < 8 && ev.payload && typeof ev.payload === 'object') {
        slot.samples.push(ev.payload);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * inferShape - 从 sample payload 数组浅扫推断字段名 + 类型，给骨架的 TODO 注释用。
 */
function inferShape(samples){
  const out = {
    topKeys: new Map(),         // k → {types: Set, count}
    itemKeys: new Map(),        // items[0] 的键
    fieldKeys: new Map(),       // payload.fields[].k 的去重集合
    hasItems: 0,
    itemsLenObserved: { min: Infinity, max: -Infinity },
    hasFields: 0,
    hasSummary: 0,
    sampleCount: 0,
  };
  for (const p of (samples || [])) {
    if (!p || typeof p !== 'object') continue;
    out.sampleCount++;
    for (const [k, v] of Object.entries(p)) bumpKey(out.topKeys, k, v);
    if (Array.isArray(p.items)) {
      out.hasItems++;
      out.itemsLenObserved.min = Math.min(out.itemsLenObserved.min, p.items.length);
      out.itemsLenObserved.max = Math.max(out.itemsLenObserved.max, p.items.length);
      const head = p.items[0];
      if (head && typeof head === 'object') {
        for (const [k, v] of Object.entries(head)) bumpKey(out.itemKeys, k, v);
      }
    }
    if (Array.isArray(p.fields)) {
      out.hasFields++;
      for (const f of p.fields) {
        if (!f || f.k == null) continue;
        bumpKey(out.fieldKeys, String(f.k), f.v);
      }
    }
    if (typeof p.summary === 'string' && p.summary) out.hasSummary++;
  }
  if (!Number.isFinite(out.itemsLenObserved.min)) out.itemsLenObserved.min = 0;
  if (!Number.isFinite(out.itemsLenObserved.max)) out.itemsLenObserved.max = 0;
  return out;
}

function bumpKey(map, k, v){
  if (!map.has(k)) map.set(k, { types: new Set(), count: 0 });
  const slot = map.get(k);
  slot.types.add(typeOf(v));
  slot.count++;
}

function typeOf(v){
  if (v == null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function safeName(s){
  return String(s || '').replace(/[^\w-]/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function pascal(s){
  const seg = String(s || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  return seg.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function renderSkeleton(skillId, kind, shape){
  const fnName = 'render' + (pascal(skillId) || 'Generic') + pascal(kind);
  const lines = [];
  lines.push("'use strict';");
  lines.push('');
  lines.push('// templates/' + skillId + '/' + kind + '.js');
  lines.push('// ---------------------------------------------------------------------------');
  lines.push('// 自动脚手架（jse-template-scaffold 生成于 ' + new Date().toISOString() + '）。');
  lines.push('// 这是一个可运行的骨架——以 _generic 兜底模板为起点，把推断字段渲成可见的');
  lines.push('// HTML，但样式与字段筛选都需要你按业务打磨（搜 TODO 改起）。');
  lines.push('//');
  lines.push('// 推断 payload shape（从 ' + shape.sampleCount + ' 条 sample 抽样）：');
  if (shape.hasItems) {
    lines.push('//   payload.items[]   出现 ' + shape.hasItems + ' 次，length range = '
      + shape.itemsLenObserved.min + '~' + shape.itemsLenObserved.max);
    if (shape.itemKeys.size) {
      lines.push('//   payload.items[0] 字段：');
      for (const [k, info] of shape.itemKeys) {
        lines.push('//     - ' + k + '  (' + Array.from(info.types).join('|') + ')  observed=' + info.count);
      }
    }
  }
  if (shape.hasFields) {
    lines.push('//   payload.fields[]  出现 ' + shape.hasFields + ' 次');
    if (shape.fieldKeys.size) {
      lines.push('//   常见 field.k 值：' + Array.from(shape.fieldKeys.keys()).slice(0, 16).join(', '));
    }
  }
  if (shape.hasSummary) lines.push('//   payload.summary   字符串，出现 ' + shape.hasSummary + ' 次');
  if (shape.topKeys.size) {
    lines.push('//   payload 顶层键：');
    for (const [k, info] of shape.topKeys) {
      if (k === 'items' || k === 'fields' || k === 'summary') continue;
      lines.push('//     - ' + k + '  (' + Array.from(info.types).join('|') + ')  observed=' + info.count);
    }
  }
  lines.push('// ---------------------------------------------------------------------------');
  lines.push('');
  lines.push("const { escapeHtml } = require('../../lib/escape');");
  lines.push('');
  lines.push('function ' + fnName + '(ctx){');
  lines.push('  const c = ctx || {};');
  lines.push('  const payload = c.payload || {};');
  lines.push("  const label = c.label || (c.hint && c.hint.label) || '" + escapeForJs(kind) + "';");
  lines.push("  const anchorAttr = c.anchorId ? ' data-anchor-id=\"' + escapeHtml(c.anchorId) + '\"' : '';");
  lines.push('');
  if (shape.hasItems) {
    lines.push('  // TODO: 这是一个 list 风格 kind，items[] 是主数据；按业务渲成更精致的 HTML（参考 reddit/list.js + cardTemplate.js）。');
    lines.push('  const items = Array.isArray(payload.items) ? payload.items : [];');
    lines.push('  const top = items.slice(0, 8);');
    lines.push("  return [");
    lines.push("    '<section class=\"reddit-stage\" data-kind=\"" + escapeForJs(kind) + "\">',");
    lines.push("    '  <header class=\"reddit-stage-head\">',");
    lines.push("    '    <h2 class=\"sub-title\">' + escapeHtml(label) + '</h2>',");
    lines.push("    '    <span class=\"count-tag\">' + items.length + ' items</span>',");
    lines.push("    '  </header>',");
    lines.push("    '  <ol class=\"reddit-card-list\"' + anchorAttr + '>',");
    lines.push("    top.map((it, i) => '<li><article class=\"reddit-card\"><div class=\"card-aside\"><span class=\"score\">' + (i + 1) + '</span></div><div class=\"card-main\"><h3 class=\"title\">' + escapeHtml(String(it && (it.title || it.name || it.label || it.id) || ('item ' + (i + 1)))) + '</h3></div></article></li>').join('\\n'),");
    lines.push("    '  </ol>',");
    lines.push("    '</section>',");
    lines.push("  ].join('\\n');");
  } else if (shape.hasFields || shape.hasSummary) {
    lines.push('  // TODO: 这是一个 KV/info-card 风格 kind，fields/summary 是主数据；按业务美化（参考 reddit/global.js）。');
    lines.push('  const fields = Array.isArray(payload.fields) ? payload.fields.slice(0, 16) : [];');
    lines.push("  const summary = String(payload.summary || '').slice(0, 240);");
    lines.push("  return [");
    lines.push("    '<section class=\"reddit-stage\" data-kind=\"" + escapeForJs(kind) + "\">',");
    lines.push("    '  <header class=\"reddit-stage-head\">',");
    lines.push("    '    <h2 class=\"sub-title\">' + escapeHtml(label) + '</h2>',");
    lines.push("    '  </header>',");
    lines.push("    '  <article class=\"reddit-info-card\"' + anchorAttr + '>',");
    lines.push("    summary ? '    <p class=\"summary\">' + escapeHtml(summary) + '</p>' : '',");
    lines.push("    fields.length ? '    <dl class=\"kv-grid\">' : '',");
    lines.push("    fields.map((f) => '      <div class=\"kv-row\"><dt>' + escapeHtml(String(f.k)) + '</dt><dd>' + escapeHtml(String(f.v == null ? \"\" : f.v).slice(0, 200)) + '</dd></div>').join('\\n'),");
    lines.push("    fields.length ? '    </dl>' : '',");
    lines.push("    '  </article>',");
    lines.push("  ].filter(Boolean).join('\\n');");
  } else {
    lines.push("  // TODO: 这个 kind 的 payload 形状还看不出主数据是什么；先把 raw payload 渲出来。");
    lines.push("  let raw = '';");
    lines.push("  try { raw = JSON.stringify(payload, null, 2); } catch (_) { raw = '[unserializable]'; }");
    lines.push("  return [");
    lines.push("    '<section class=\"reddit-stage\" data-kind=\"" + escapeForJs(kind) + "\">',");
    lines.push("    '  <header class=\"reddit-stage-head\">',");
    lines.push("    '    <h2 class=\"sub-title\">' + escapeHtml(label) + '</h2>',");
    lines.push("    '  </header>',");
    lines.push("    '  <article class=\"reddit-info-card\"' + anchorAttr + '>',");
    lines.push("    '    <pre style=\"font-size:11px;line-height:1.4;\">' + escapeHtml(raw) + '</pre>',");
    lines.push("    '  </article>',");
    lines.push("  ].join('\\n');");
  }
  lines.push('}');
  lines.push('');
  lines.push('module.exports = ' + fnName + ';');
  lines.push('');
  return lines.join('\n');
}

function renderIndexFile(skillId, kindToFn){
  const lines = [];
  lines.push("'use strict';");
  lines.push('');
  lines.push('// templates/' + skillId + '/index.js');
  lines.push('// 自动脚手架（jse-template-scaffold）。把每个 kind 的渲染函数注册到 registry。');
  lines.push('');
  lines.push("const { register } = require('../registry');");
  for (const k of kindToFn.keys()) {
    lines.push("const " + safeVar(k) + " = require('./" + k + "');");
  }
  lines.push('');
  lines.push("const SKILL_ID = '" + escapeForJs(skillId) + "';");
  lines.push('');
  for (const k of kindToFn.keys()) {
    lines.push("register(SKILL_ID, '" + escapeForJs(k) + "', " + safeVar(k) + ");");
  }
  lines.push('');
  lines.push('module.exports = { SKILL_ID };');
  lines.push('');
  return lines.join('\n');
}

function safeVar(s){
  return 'render' + pascal(s);
}

function escapeForJs(s){
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function main(argv){
  let opts;
  try { opts = parseArgs(argv); }
  catch (err) { process.stderr.write('ERROR: ' + err.message + '\n'); return 2; }
  if (opts.help || !opts.sessionDir) { printHelp(); return opts.help ? 0 : 2; }

  const sessionDir = path.resolve(opts.sessionDir);
  if (!fs.existsSync(sessionDir)) {
    process.stderr.write('ERROR: session dir not found: ' + sessionDir + '\n');
    return 2;
  }

  const session = readVisualSession(sessionDir);
  if (!session.meta && (!session.entries || session.entries.length === 0)) {
    process.stderr.write('ERROR: empty session bundle at ' + sessionDir + '\n');
    return 1;
  }

  const observed = extractKindsFromSession(session, opts.skillId);
  if (observed.length === 0) {
    process.stdout.write('[scaffold] no after events found in session, nothing to scan\n');
    return 0;
  }

  process.stdout.write('[scaffold] observed (skillId, kind) pairs:\n');
  for (const o of observed) {
    process.stdout.write('  - ' + o.skillId + ' / ' + o.kind + '  count=' + o.count + '\n');
  }

  const unknown = findUnknownKinds(observed.map((o) => ({ skillId: o.skillId, kind: o.kind, count: o.count })));
  if (unknown.length === 0) {
    process.stdout.write('[scaffold] all kinds registered (no fallback hits). Nothing to scaffold.\n');
    process.stdout.write('[scaffold] currently registered templates:\n');
    for (const t of listTemplates()) {
      process.stdout.write('  - ' + t.skillId + ' / ' + t.kind + '\n');
    }
    return 0;
  }

  process.stdout.write('\n[scaffold] unknown / fallback-hitting (skillId, kind):\n');
  for (const u of unknown) {
    process.stdout.write('  - ' + u.skillId + ' / ' + u.kind + '  count=' + u.count + '  tier=' + u.tier + '\n');
  }

  const outRoot = path.resolve(opts.out || './templates-scaffold');
  process.stdout.write('\n[scaffold] output root: ' + outRoot + (opts.dryRun ? '   (DRY-RUN)' : '') + '\n');

  // 组织 sample 字典：(sid, kind) → samples
  const sampleMap = new Map();
  for (const o of observed) sampleMap.set(o.skillId + '::' + o.kind, o.samples);

  // 按 skillId 分组生成
  const bySkill = new Map();
  for (const u of unknown) {
    if (!bySkill.has(u.skillId)) bySkill.set(u.skillId, new Map());
    const samples = sampleMap.get(u.skillId + '::' + u.kind) || [];
    const shape = inferShape(samples);
    bySkill.get(u.skillId).set(u.kind, shape);
  }

  let written = 0;
  for (const [skillId, kindMap] of bySkill) {
    const dir = path.join(outRoot, safeName(skillId));
    process.stdout.write('\n[scaffold] ' + skillId + ' →\n');

    for (const [kind, shape] of kindMap) {
      const file = path.join(dir, safeName(kind) + '.js');
      const code = renderSkeleton(skillId, kind, shape);
      process.stdout.write('  - ' + file + '  (sampleCount=' + shape.sampleCount + ')\n');
      if (!opts.dryRun) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, code, 'utf8');
        written++;
      }
    }

    const indexPath = path.join(dir, 'index.js');
    process.stdout.write('  - ' + indexPath + '\n');
    if (!opts.dryRun) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(indexPath, renderIndexFile(skillId, kindMap), 'utf8');
      written++;
    }
  }

  process.stdout.write('\n[scaffold] done. ' + (opts.dryRun ? '(dry-run, nothing written) ' : 'wrote ' + written + ' files. ')
    + 'Review then `mv ' + outRoot + '/<skill> packages/visual-replay-hyperframes/templates/<skill>` and require it from translator.js.\n');
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c || 0)).catch((e) => {
    process.stderr.write('FATAL: ' + (e && e.stack || e) + '\n');
    process.exit(1);
  });
}

module.exports = { main, parseArgs, extractKindsFromSession, inferShape, renderSkeleton };
