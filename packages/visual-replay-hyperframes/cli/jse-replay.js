#!/usr/bin/env node
'use strict';

// jse-replay CLI（v0.7.2 plugin-system + 技能 template bootstrap）
// ---------------------------------------------------------------------------
// 用法：
//   jse-replay <session-dir> [--out <video.mp4>] [--preview] [--keep-composition]
//              [--title <s>] [--no-render]
//              [--snapshot=auto|always|never]
//              [--plugin <id>]                       (可重复)
//              [--plugin-config '<id>={...}']        (可重复)
//              [--effects=auto|none]                 （仅 mode-aware / 显式关默认 plugin）
//              [--no-effects]                         等价 --effects=none
//
// v0.7.1：CLI 不再接受 `--effects=hud,flash` / `all`（易与 `--plugin` 混淆）。要叠合成端
// HUD/flash 请显式：`--plugin=@builtin/hud --plugin=@builtin/flash`。
//
// v0.7.0 起：
//   - `--plugin <id>` 注册一个 plugin（按出现顺序生效，重复会去重）
//   - `--plugin-config '<id>={JSON}'` 给特定 plugin 私有配置
//
// 默认行为（与 v0.6.0 一致）：
//   - snapshot mode 默认 plugins=[]（"录制 = 干净"）
//   - template mode 默认 plugins=[@builtin/hud, @builtin/flash]
//
// 仍然 hard-error（v0.6.0 立的）：
//   - --effects=cursor|typing|click|ripple|spinner|scroll|shell → unknown effect (exit 1)
//   - --shell / --no-shell / --frames-debug / --width / --height → 未知参数 (exit 2)
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { translate } = require('../index');

// v0.5.x 曾支持的 effect 名；v0.6.0 起全部移除（CLI 仍拒绝）
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
    // --effects 仅 auto | none（template 默认 builtin 由 translate() mode-aware 决定）
    effects: 'auto',          // 'auto' | 'none'
    snapshot: 'auto',         // 'auto' | 'always' | 'never'
    plugins: [],              // ['<id>', ...]，按出现顺序去重
    pluginConfigs: {},        // { '<id>': {...} }
    effectsExplicit: false,   // 用户是否显式传过 --effects/--no-effects
    templateBootstrap: null,  // 可选 .js，register 技能模板；省略则走环境变量 / session 旁探测
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
    if (a === '--effects' && argv[i + 1]) { opts.effects = argv[++i]; opts.effectsExplicit = true; continue; }
    if (a.startsWith('--effects=')) { opts.effects = a.slice('--effects='.length); opts.effectsExplicit = true; continue; }
    if (a === '--no-effects') { opts.effects = 'none'; opts.effectsExplicit = true; continue; }
    if (a === '--all-effects') {
      throw new Error('已移除 --all-effects。请使用 --plugin=@builtin/hud --plugin=@builtin/flash');
    }
    if (a === '--snapshot' && argv[i + 1]) { opts.snapshot = argv[++i]; continue; }
    if (a.startsWith('--snapshot=')) { opts.snapshot = a.slice('--snapshot='.length); continue; }
    if (a === '--no-snapshot') { opts.snapshot = 'never'; continue; }
    if (a === '--plugin' && argv[i + 1]) { opts.plugins.push(argv[++i]); continue; }
    if (a.startsWith('--plugin=')) { opts.plugins.push(a.slice('--plugin='.length)); continue; }
    if (a === '--plugin-config' && argv[i + 1]) { applyPluginConfig(opts.pluginConfigs, argv[++i]); continue; }
    if (a.startsWith('--plugin-config=')) { applyPluginConfig(opts.pluginConfigs, a.slice('--plugin-config='.length)); continue; }
    if (a === '--template-bootstrap' && argv[i + 1]) { opts.templateBootstrap = argv[++i]; continue; }
    if (a.startsWith('--template-bootstrap=')) { opts.templateBootstrap = a.slice('--template-bootstrap='.length); continue; }
    if (a.startsWith('-')) { throw new Error('未知参数: ' + a); }
    if (!opts.sessionDir) { opts.sessionDir = a; continue; }
    throw new Error('多余的位置参数: ' + a);
  }
  return opts;
}

/**
 * 校验 `--effects`：**仅**允许 `auto`（默认）与 `none`（含 `--no-effects`）。
 * `hud` / `flash` / `all` 等旧写法已移除，避免与 `--plugin` 双轨混淆。
 *
 * @returns {{ error?: string }} error 非空 → CLI exit 1
 */
function validateCompositionEffects(input){
  if (!input || input === 'auto') return { error: null };
  if (input === 'none') return { error: null };
  if (typeof input !== 'string') return { error: null };
  const tokens = input.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  for (const t of tokens) {
    if (t === 'auto' || t === 'none') continue;
    if (REMOVED_EFFECTS.has(t)) {
      return { error: 'unknown effect: ' + t + ' (removed in v0.6.0; snapshot mode carries real screenshots, see CHANGELOG)' };
    }
    if (t === 'hud' || t === 'flash' || t === 'all') {
      return { error: '--effects 不再接受 hud/flash/all（v0.7.1）。请在需要合成端 HUD/flash 时使用 --plugin=@builtin/hud 与/或 --plugin=@builtin/flash' };
    }
    return { error: '--effects 仅支持 auto（默认）或 none；未知 token: ' + t };
  }
  return { error: null };
}

/**
 * 解析 --plugin-config '<id>={JSON}'。id 不能包含 '='；JSON 部分一律按 strict JSON
 * 解析，非法 JSON 直接抛错（fail-fast，错就错在生成时）。
 */
function applyPluginConfig(target, raw){
  if (!raw || typeof raw !== 'string') {
    throw new Error('--plugin-config 不能为空');
  }
  const eqIdx = raw.indexOf('=');
  if (eqIdx <= 0) {
    throw new Error('--plugin-config 格式错误，应为 \'<id>={...}\': ' + raw);
  }
  const id = raw.slice(0, eqIdx).trim();
  const json = raw.slice(eqIdx + 1).trim();
  if (!id) throw new Error('--plugin-config id 不能为空: ' + raw);
  let parsed;
  try { parsed = JSON.parse(json); }
  catch (err) {
    throw new Error('--plugin-config 的 JSON 解析失败 (' + id + '): ' + err.message);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--plugin-config (' + id + ') 必须是 JSON object');
  }
  target[id] = Object.assign({}, target[id] || {}, parsed);
}

function printHelp(){
  const lines = [
    'jse-replay (v0.7.2) - 把 visual session bundle 转译并 spawn hyperframes 渲染',
    '                      events 含 frame → snapshot 双缓冲背景图；否则 list/item 模板兑底',
    '',
    'Usage:',
    '  jse-replay <session-dir> [options]',
    '',
    'Options:',
    '  --out <file.mp4>            渲染输出路径（默认 <session-dir>/replay.mp4）',
    '  --preview                   启动 hyperframes preview 而非 render',
    '  --no-render                 只生成 composition 目录，不调用 hyperframes',
    '  --keep-composition          渲染完保留 composition/ 目录',
    '  --title <s>                 页面 title',
    '  --skill <id>                显式指定 skillId 以路由模板（默认从 meta.json 读）',
    '',
    '  Template bootstrap（v0.7.2+，list/item 等技能模板不再随引擎包分发）：',
    '  --template-bootstrap <path>  入口 .js（副作用 register）；也可设环境变量',
    '                                 JSE_REPLAY_TEMPLATE_BOOTSTRAP。省略时若会话在',
    '                                 <skill>/runs/<sess>/ 则自动加载 <skill>/replay-templates/index.js',
    '',
    '  Snapshot mode:',
    '  --snapshot <mode>           auto (默认，events 含 frame 即用) | always | never',
    '  --no-snapshot               等价 --snapshot=never，强制走模板路径',
    '',
    '  Plugin system (v0.7.0+):',
    '  --plugin <id>               注册一个 plugin（可重复，按出现顺序生效）',
    '                              支持：@builtin/hud / @builtin/flash / @js-eyes/spotlight',
    '                                    或本地路径 ./xxx.js / 绝对路径',
    '  --plugin-config \'<id>={...}\' 给特定 plugin 私有 JSON 配置（可重复）',
    '',
    '  默认 plugin（mode-aware，无需传 flag）：',
    '    snapshot → 无 builtin；template → @builtin/hud + @builtin/flash',
    '',
    '  Composition 策略（仅 auto | none，不设具体 effect 名字）：',
    '  --effects <mode>            auto (默认) | none（强制关掉上述 mode-aware 默认 builtin）',
    '  --no-effects                等价 --effects=none',
    '                              要叠 HUD/flash 请用 --plugin=@builtin/hud / --plugin=@builtin/flash',
    '',
    '  -v, --verbose               输出 spawn 的命令',
    '  -h, --help                  显示帮助',
    '',
    'Removed in v0.6.0 (会报错):',
    '  --shell / --no-shell                     snapshot 模式截图自带 chrome；template 无 chrome',
    '  --effects=cursor|typing|click|ripple|... dom_* 合成动画已下线，回退请用 0.5.2',
    '  --frames-debug / --width / --height      已 noop 多版',
    '',
    'Examples:',
    '  jse-replay runs/sess-001                                    # 默认 snapshot + 干净录制',
    '  jse-replay runs/sess-001 --plugin=@js-eyes/spotlight        # snapshot 上加聚光灯',
    '  jse-replay runs/sess-001 --plugin=./my-watermark.js         # 本地 plugin',
    '  jse-replay runs/sess-001 --plugin=@builtin/hud \\',
    '             --plugin=@js-eyes/spotlight \\',
    '             --plugin-config \'@js-eyes/spotlight={"radius":120,"tone":"orange"}\'',
    '  jse-replay runs/sess-001 --plugin=@builtin/hud --plugin=@builtin/flash  # snapshot 上叠合成端 HUD+flash',
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

  const effCheck = validateCompositionEffects(opts.effects);
  if (effCheck.error) {
    process.stderr.write('ERROR: ' + effCheck.error + '\n');
    return 1;
  }
  const pluginIds = Array.isArray(opts.plugins) ? opts.plugins : [];

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
      // effects=auto 仍旧透给 translate()，让 mode-aware 默认行为生效（没显式 --effects/--plugin）
      effects: opts.effectsExplicit ? opts.effects : (pluginIds.length ? 'none' : 'auto'),
      snapshot: opts.snapshot,
      plugins: pluginIds,
      pluginConfigs: opts.pluginConfigs,
      cwd: process.cwd(),
      templateBootstrap: opts.templateBootstrap || undefined,
    });
  } catch (err) {
    process.stderr.write('ERROR: translate failed: ' + err.message + '\n');
    if (opts.verbose && err.stack) process.stderr.write(err.stack + '\n');
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
  const pluginNames = (result.plugins || []).map((p) => p.name);
  process.stderr.write('[jse-replay] plugins:          ' + (pluginNames.length ? pluginNames.join(', ') : '(none)') + '\n');

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
    plugins: r.plugins || [],
    sessionId: r.meta && r.meta.sessionId,
    skillId: r.meta && r.meta.skillId,
    architecture: 'plugin-system (v0.7.2)',
  };
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code || 0)).catch((err) => {
    process.stderr.write('FATAL: ' + (err && err.stack ? err.stack : err) + '\n');
    process.exit(1);
  });
}

module.exports = { main, parseArgs, validateCompositionEffects, applyPluginConfig };
