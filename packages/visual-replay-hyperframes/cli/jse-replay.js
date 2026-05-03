#!/usr/bin/env node
'use strict';

// jse-replay CLI
// ---------------------------------------------------------------------------
// 用法：
//   jse-replay <session-dir> [--out <video.mp4>] [--preview] [--keep-composition]
//              [--width <n>] [--height <n>] [--title <s>] [--no-render]
//
// 行为：
//   1. 读会话包 → 转译成 hyperframes composition 目录（默认在 <session-dir>/composition/）
//   2. --preview     → spawn `npx hyperframes preview <composition>`
//      --no-render   → 只生成 composition，不调用 hyperframes
//      默认          → spawn `npx hyperframes render <composition> -o <out>`
//   3. --keep-composition 渲染完保留中间产物
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { translate } = require('../index');

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
    framesDebug: false,
    // v0.5.0 snapshot mode flags
    // v0.5.1: effects 默认 'auto'（mode-aware）：snapshot 模式 → none，template 模式
    // → hud+flash（保留 v0.4.0 那两个最显眼的 overlay 不变）。用户显式传 --effects /
    // --no-effects / --all-effects 都会覆盖。
    effects: 'auto',          // 'auto' | 'none' | 'all' | 'cursor,typing,...'
    shell: 'fallback-only',   // 'auto' | 'always' | 'never' | 'fallback-only'
    snapshot: 'auto',         // 'auto' | 'always' | 'never'
    deprecated: [],
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
    // v0.5.0 snapshot mode 三 flag
    if (a === '--effects' && argv[i + 1]) { opts.effects = argv[++i]; continue; }
    if (a.startsWith('--effects=')) { opts.effects = a.slice('--effects='.length); continue; }
    if (a === '--no-effects') { opts.effects = 'none'; continue; }
    if (a === '--all-effects') { opts.effects = 'all'; continue; }
    if (a === '--shell' && argv[i + 1]) { opts.shell = argv[++i]; continue; }
    if (a.startsWith('--shell=')) { opts.shell = a.slice('--shell='.length); continue; }
    if (a === '--no-shell') { opts.shell = 'never'; continue; }
    if (a === '--snapshot' && argv[i + 1]) { opts.snapshot = argv[++i]; continue; }
    if (a.startsWith('--snapshot=')) { opts.snapshot = a.slice('--snapshot='.length); continue; }
    if (a === '--no-snapshot') { opts.snapshot = 'never'; continue; }
    // post-2.7.0：以下 flag 已弃用（仍解析，不影响主链路）
    if (a === '--frames-debug') { opts.framesDebug = true; opts.deprecated.push('--frames-debug'); continue; }
    if (a === '--width' || a.startsWith('--width=')) { opts.deprecated.push('--width'); if (a === '--width') i += 1; continue; }
    if (a === '--height' || a.startsWith('--height=')) { opts.deprecated.push('--height'); if (a === '--height') i += 1; continue; }
    if (a.startsWith('-')) { throw new Error('未知参数: ' + a); }
    if (!opts.sessionDir) { opts.sessionDir = a; continue; }
    throw new Error('多余的位置参数: ' + a);
  }
  return opts;
}

function printHelp(){
  const lines = [
    'jse-replay - 把 visual session bundle 转译并 spawn hyperframes 渲染',
    '             （v0.5.0 snapshot mode：events 含 frame → PNG 序列；否则退模板）',
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
    '  v0.5.0 snapshot mode：',
    '  --snapshot <mode>       auto (默认，events 含 frame 即用) | always | never',
    '  --no-snapshot           等价 --snapshot=never，强制走 v0.4.0 模板路径',
    '  --shell <mode>          fallback-only (默认) | auto | always | never；',
    '                          dom 段（有 frames）默认隐 chrome，api fallback 段保留',
    '  --no-shell              等价 --shell=never，全程不渲 reddit chrome',
    '  --effects <list>        auto (默认；snapshot=none, template=hud+flash) | none | all',
    '                          | cursor,typing,click,ripple,spinner,scroll,shell,hud,flash 任意组合',
    '                          opt-in 后期叠加合成视觉；snapshot 模式默认不冗余',
    '  --no-effects            等价 --effects=none',
    '  --all-effects           等价 --effects=all（v0.4.0 行为复刻）',
    '',
    '  -v, --verbose           输出 spawn 的命令',
    '  -h, --help              显示帮助',
    '',
    'Deprecated (仍接受，不再生效):',
    '  --frames-debug          v0.5.0 主链路 PNG 截图已恢复，本 flag 等价 --snapshot=auto',
    '  --width / --height      composition 不再有固定像素尺寸（响应式 vw/clamp）',
    '',
    'Examples:',
    '  jse-replay runs/sess-001                                 # 默认 snapshot + HUD',
    '  jse-replay runs/sess-001 --effects=cursor,typing         # 加 cursor + typing 叠层',
    '  jse-replay runs/sess-001 --all-effects --shell=always    # 等价 v0.4.0 完整体验',
    '  jse-replay runs/sess-001 --no-snapshot                   # 强制走 v0.4.0 模板路径',
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

  const sessionDir = path.resolve(opts.sessionDir);
  if (!fs.existsSync(sessionDir)) {
    process.stderr.write('ERROR: session dir not found: ' + sessionDir + '\n');
    return 2;
  }

  if (Array.isArray(opts.deprecated) && opts.deprecated.length > 0) {
    process.stderr.write('[jse-replay] deprecated flag(s) ignored (post-2.7.0 HTML pivot): '
      + Array.from(new Set(opts.deprecated)).join(', ') + '\n');
  }

  const compositionDir = path.join(sessionDir, 'composition');
  let result;
  try {
    result = translate(sessionDir, compositionDir, {
      title: opts.title || undefined,
      skillId: opts.skillId || undefined,
      effects: opts.effects,
      shell: opts.shell,
      snapshot: opts.snapshot,
    });
  } catch (err) {
    process.stderr.write('ERROR: translate failed: ' + err.message + '\n');
    return 1;
  }

  process.stderr.write('[jse-replay] composition:      ' + result.compositionPath + '\n');
  process.stderr.write('[jse-replay] mode:             ' + result.snapshotMode + ' (shell=' + result.shellPolicy + ')\n');
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
    shellPolicy: r.shellPolicy || 'fallback-only',
    effects: r.effects || {},
    sessionId: r.meta && r.meta.sessionId,
    skillId: r.meta && r.meta.skillId,
    architecture: 'snapshot-mode (v0.5.0)',
  };
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code || 0)).catch((err) => {
    process.stderr.write('FATAL: ' + (err && err.stack ? err.stack : err) + '\n');
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
