#!/usr/bin/env node
'use strict';

// jse-replay CLI（v0.6.0 snapshot-only-prune）
// ---------------------------------------------------------------------------
// 用法：
//   jse-replay <session-dir> [--out <video.mp4>] [--preview] [--keep-composition]
//              [--title <s>] [--no-render]
//              [--snapshot=auto|always|never] [--effects=auto|none|all|hud,flash]
//
// 行为：
//   1. 读会话包 → 转译成 hyperframes composition 目录（默认在 <session-dir>/composition/）
//   2. --preview     → spawn `npx hyperframes preview <composition>`
//      --no-render   → 只生成 composition，不调用 hyperframes
//      默认          → spawn `npx hyperframes render <composition> -o <out>`
//   3. --keep-composition 渲染完保留中间产物
//
// v0.6.0 breaking：
//   - 删 --shell / --no-shell（snapshot 模式截图自带 chrome；template 模式无 chrome）
//   - --effects=cursor|typing|click|ripple|spinner|scroll → unknown effect (exit 1)
//   - 删 deprecated flag --frames-debug / --width / --height（已 noop 多版）
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { translate } = require('../index');

// v0.6.0 起仅认这两个 effect；其他键报 unknown effect 退出 1
const KNOWN_EFFECTS = new Set(['hud', 'flash']);
// v0.5.x 曾支持的 effect 名；v0.6.0 全部移除
const REMOVED_EFFECTS = new Set(['cursor', 'typing', 'click', 'ripple', 'spinner', 'scroll', 'shell']);

function parseArgs(argv){
  const opts = {
    sessionDir: null,
    out: null,
    preview: false,
    keepComposition: false,
    noRender: false,
    title: null,
    skillId: null,
    help: false,
    verbose: false,
    // effects 默认 'auto'（mode-aware）：snapshot 模式 → none，template 模式 → hud+flash。
    // 用户显式传 --effects / --no-effects / --all-effects 都会覆盖。
    effects: 'auto',          // 'auto' | 'none' | 'all' | 'hud' | 'flash' | 'hud,flash'
    snapshot: 'auto',         // 'auto' | 'always' | 'never'
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a === '-v' || a === '--verbose') { opts.verbose = true; continue; }
    if (a === '--out' && argv[i + 1]) { opts.out = argv[++i]; continue; }
    if (a.startsWith('--out=')) { opts.out = a.slice('--out='.length); continue; }
    if (a === '--preview') { opts.preview = true; continue; }
    if (a === '--keep-composition' || a === '--keep') { opts.keepComposition = true; continue; }
    if (a === '--no-render') { opts.noRender = true; continue; }
    if (a === '--title' && argv[i + 1]) { opts.title = argv[++i]; continue; }
    if (a.startsWith('--title=')) { opts.title = a.slice('--title='.length); continue; }
    if (a === '--skill' && argv[i + 1]) { opts.skillId = argv[++i]; continue; }
    if (a.startsWith('--skill=')) { opts.skillId = a.slice('--skill='.length); continue; }
    if (a === '--effects' && argv[i + 1]) { opts.effects = argv[++i]; continue; }
    if (a.startsWith('--effects=')) { opts.effects = a.slice('--effects='.length); continue; }
    if (a === '--no-effects') { opts.effects = 'none'; continue; }
    if (a === '--all-effects') { opts.effects = 'all'; continue; }
    if (a === '--snapshot' && argv[i + 1]) { opts.snapshot = argv[++i]; continue; }
    if (a.startsWith('--snapshot=')) { opts.snapshot = a.slice('--snapshot='.length); continue; }
    if (a === '--no-snapshot') { opts.snapshot = 'never'; continue; }
    if (a.startsWith('-')) { throw new Error('未知参数: ' + a); }
    if (!opts.sessionDir) { opts.sessionDir = a; continue; }
    throw new Error('多余的位置参数: ' + a);
  }
  return opts;
}

/**
 * v0.6.0：把 --effects 字符串里的每个 token 校验一遍，命中 REMOVED_EFFECTS 直接报错。
 * 'auto' / 'none' / 'all' / 任意 KNOWN_EFFECTS 都通过。
 *
 * @returns {string|null} 错误信息（null = 校验通过）
 */
function validateEffects(input){
  if (!input) return null;
  if (input === 'auto' || input === 'none' || input === 'all') return null;
  if (typeof input !== 'string') return null;
  const tokens = input.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  for (const t of tokens) {
    if (t === 'all' || t === 'none' || t === 'auto') continue;
    if (KNOWN_EFFECTS.has(t)) continue;
    if (REMOVED_EFFECTS.has(t)) {
      return 'unknown effect: ' + t + ' (removed in v0.6.0; snapshot mode carries real screenshots, see CHANGELOG)';
    }
    return 'unknown effect: ' + t + ' (known: ' + Array.from(KNOWN_EFFECTS).join(',') + ')';
  }
  return null;
}

function printHelp(){
  const lines = [
    'jse-replay (v0.6.0) - 把 visual session bundle 转译并 spawn hyperframes 渲染',
    '                      events 含 frame → snapshot 双缓冲背景图；否则 list/item 模板兑底',
    '',
    'Usage:',
    '  jse-replay <session-dir> [options]',
    '',
    'Options:',
    '  --out <file.mp4>        渲染输出路径（默认 <session-dir>/replay.mp4）',
    '  --preview               启动 hyperframes preview 而非 render',
    '  --no-render             只生成 composition 目录，不调用 hyperframes',
    '  --keep-composition      渲染完保留 composition/ 目录',
    '  --title <s>             页面 title',
    '  --skill <id>            显式指定 skillId 以路由模板（默认从 meta.json 读）',
    '',
    '  snapshot mode：',
    '  --snapshot <mode>       auto (默认，events 含 frame 即用) | always | never',
    '  --no-snapshot           等价 --snapshot=never，强制走模板路径',
    '',
    '  effects（v0.6.0：仅剩 hud / flash 两个 opt-in overlay）：',
    '  --effects <list>        auto (默认；snapshot=none, template=hud+flash) | none | all',
    '                          | hud | flash | hud,flash 任意组合',
    '  --no-effects            等价 --effects=none',
    '  --all-effects           等价 --effects=all（hud + flash）',
    '',
    '  -v, --verbose           输出 spawn 的命令',
    '  -h, --help              显示帮助',
    '',
    'Removed in v0.6.0 (会报错):',
    '  --shell / --no-shell                 snapshot 模式截图自带 chrome；template 无 chrome',
    '  --effects=cursor|typing|click|...    dom_* 合成动画已下线，回退请用 0.5.2',
    '  --frames-debug / --width / --height  已 noop 多版',
    '',
    'Examples:',
    '  jse-replay runs/sess-001                              # 默认 snapshot + 干净录制',
    '  jse-replay runs/sess-001 --effects=hud                # snapshot 上 opt-in HUD overlay',
    '  jse-replay runs/sess-001 --no-snapshot                # 走 template 卡片路径',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function spawnHyperframes(args, opts){
  if (opts.verbose) {
    process.stderr.write('[jse-replay] spawning: npx ' + ['hyperframes'].concat(args).join(' ') + '\n');
  }
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['--yes', 'hyperframes'].concat(args), {
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(0);
      else reject(new Error('hyperframes exited with code ' + code));
    });
  });
}

async function main(argv){
  let opts;
  try { opts = parseArgs(argv); }
  catch (err) {
    process.stderr.write('ERROR: ' + err.message + '\n');
    return 2;
  }
  if (opts.help || !opts.sessionDir) {
    printHelp();
    return opts.help ? 0 : 2;
  }

  // v0.6.0：硬校验 --effects
  const effErr = validateEffects(opts.effects);
  if (effErr) {
    process.stderr.write('ERROR: ' + effErr + '\n');
    return 1;
  }

  const sessionDir = path.resolve(opts.sessionDir);
  if (!fs.existsSync(sessionDir)) {
    process.stderr.write('ERROR: session dir not found: ' + sessionDir + '\n');
    return 2;
  }

  const compositionDir = path.join(sessionDir, 'composition');
  let result;
  try {
    result = translate(sessionDir, compositionDir, {
      title: opts.title || undefined,
      skillId: opts.skillId || undefined,
      effects: opts.effects,
      snapshot: opts.snapshot,
    });
  } catch (err) {
    process.stderr.write('ERROR: translate failed: ' + err.message + '\n');
    return 1;
  }

  process.stderr.write('[jse-replay] composition:      ' + result.compositionPath + '\n');
  process.stderr.write('[jse-replay] mode:             ' + result.snapshotMode + '\n');
  process.stderr.write('[jse-replay] duration:         ' + result.durationSec.toFixed(2) + 's\n');
  process.stderr.write('[jse-replay] hud clips:        ' + result.hudCount + '\n');
  process.stderr.write('[jse-replay] flash clips:      ' + (result.flashCount || 0) + '\n');
  process.stderr.write('[jse-replay] relation clips:   ' + (result.relationCount || 0) + '\n');
  process.stderr.write('[jse-replay] cards:            ' + (result.cardCount || 0) + '\n');
  process.stderr.write('[jse-replay] total data items: ' + (result.totalDataItems || 0) + '\n');
  process.stderr.write('[jse-replay] frames:           ' + (result.frameCount || 0) + ' (copied=' + (result.framesCopied || 0) + ')\n');
  const onEffects = Object.keys(result.effects || {}).filter((k) => result.effects[k]);
  process.stderr.write('[jse-replay] effects:          ' + (onEffects.length ? onEffects.join(',') : 'none') + '\n');

  if (opts.noRender) {
    process.stdout.write(JSON.stringify({ ok: true, composition: compositionDir, ...stripMeta(result) }) + '\n');
    return 0;
  }

  if (opts.preview) {
    try {
      await spawnHyperframes(['preview', compositionDir], opts);
      return 0;
    } catch (err) {
      process.stderr.write('ERROR: ' + err.message + '\n');
      return 1;
    }
  }

  const outPath = path.resolve(opts.out || path.join(sessionDir, 'replay.mp4'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  try {
    await spawnHyperframes(['render', compositionDir, '--output', outPath], opts);
  } catch (err) {
    process.stderr.write('ERROR: ' + err.message + '\n');
    return 1;
  }

  if (!opts.keepComposition) {
    try { fs.rmSync(compositionDir, { recursive: true, force: true }); } catch (_) {}
  }

  process.stdout.write(JSON.stringify({ ok: true, video: outPath, ...stripMeta(result) }) + '\n');
  return 0;
}

function stripMeta(r){
  return {
    durationSec: r.durationSec,
    hudCount: r.hudCount,
    flashCount: r.flashCount || 0,
    relationCount: r.relationCount || 0,
    cardCount: r.cardCount || 0,
    totalDataItems: r.totalDataItems || 0,
    frameCount: r.frameCount || 0,
    framesCopied: r.framesCopied || 0,
    snapshotMode: r.snapshotMode || 'template',
    effects: r.effects || {},
    sessionId: r.meta && r.meta.sessionId,
    skillId: r.meta && r.meta.skillId,
    architecture: 'snapshot-only-prune (v0.6.0)',
  };
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code || 0)).catch((err) => {
    process.stderr.write('FATAL: ' + (err && err.stack ? err.stack : err) + '\n');
    process.exit(1);
  });
}

module.exports = { main, parseArgs, validateEffects };
