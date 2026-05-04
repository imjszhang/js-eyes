'use strict';

// lib/cliVisualFlags.js
// ---------------------------------------------------------------------------
// 在 browser-read.js / browser-interact.js 共用的 CLI flag 解析。
//
// 支持的 flag（与 reddit-ops 保持一致）：
//   --visual                 显式开（默认就开）
//   --no-visual              关闭视觉反馈（trace 也不写）
//   --visual-detail compact|staged
//   --visual-ms <n>          flash 持续时长（默认 420，clamp 120–4000）
//   --visual-hud / --no-visual-hud      右上角 HUD 卡片（默认开；v0.6.0 取代 --visual-mode hud/dom）
//   --visual-flash / --no-visual-flash  元素 flash overlay + relation（默认开）
//   --visual-trace <file>    把事件写入 jsonl（单文件形态）
//   --visual-record <dir>    把事件写入会话包目录（meta.json + events.jsonl）
//                            给离线 hyperframes 重渲染用
//   --no-visual-record       显式关闭会话包写入
//   --visual-list-stride <ms>
//   --visual-prefix <p>      DOM id 前缀（默认 __jse_browser_visual_）
//
// post-2.7.0 architecture pivot：
//   --redact-rect / --redact-selector / --redact-config 仍解析（不会报错），
//   但已下线，主链路不再消费；parseVisualFlags 返回 deprecatedFlags，统一
//   通过 warnDeprecatedFlagsOnce 打 stderr 一次性告警。
//
// 提供两个 helper：
//   - applyVisualArgs(args, i, options)  在 parseArgs 循环里识别 visual flag，
//                                          返回消耗的 argv 步数（0 表示不是 visual flag）
//   - resolveVisualOptions(options)      把 options.visual* 字段过 parseVisualFlags，
//                                          返回 { visual: { config, tracePath, recordDir } }
//                                          + deprecatedFlags 数组
// ---------------------------------------------------------------------------

const { parseVisualFlags } = require('@js-eyes/visual-bridge-kit');

const _warnedFlags = new Set();
function warnDeprecatedFlagsOnce(deprecatedFlags){
  if (!Array.isArray(deprecatedFlags) || deprecatedFlags.length === 0) return;
  const fresh = deprecatedFlags.filter((f) => !_warnedFlags.has(f));
  if (fresh.length === 0) return;
  for (const f of fresh) _warnedFlags.add(f);
  try {
    process.stderr.write(
      '[js-browser-ops-skill] deprecated visual flag(s) ignored: '
      + fresh.join(', ')
      + ' (post-2.7.0 architecture pivot — main pipeline no longer consumes PNG/redact;'
      + ' use require("@js-eyes/visual-bridge-kit/dev").makeFrameWriter for the legacy PNG path)\n'
    );
  } catch (_) {}
}

const BROWSER_VISUAL_DEFAULTS = { prefix: '__jse_browser_visual_' };

/**
 * 在每个 script 的 parseArgs 循环里调用。
 * @returns {number} 跳过几个 argv（0 = 不识别）
 */
function applyVisualArgs(args, i, options){
  const a = args[i];
  if (a === '--visual') { options.visual = true; return 1; }
  if (a === '--no-visual') { options.visual = false; return 1; }
  if (a === '--visual-detail' && args[i + 1]) { options.visualDetail = args[i + 1]; return 2; }
  if (a.startsWith('--visual-detail=')) { options.visualDetail = a.slice('--visual-detail='.length); return 1; }
  if (a === '--visual-ms' && args[i + 1]) { options.visualMs = args[i + 1]; return 2; }
  if (a.startsWith('--visual-ms=')) { options.visualMs = a.slice('--visual-ms='.length); return 1; }
  if (a === '--visual-hud') { options.visualHud = true; return 1; }
  if (a === '--no-visual-hud') { options.visualHud = false; return 1; }
  if (a === '--visual-flash') { options.visualFlash = true; return 1; }
  if (a === '--no-visual-flash') { options.visualFlash = false; return 1; }
  // v0.6.0 BREAKING：--visual-mode 已硬切；仍解析记录到 options 让 parseVisualFlags
  // 把它收进 deprecatedFlags 给 stderr 打告警，但不再下发到 bridge config。
  if (a === '--visual-mode' && args[i + 1]) { options.visualMode = args[i + 1]; return 2; }
  if (a.startsWith('--visual-mode=')) { options.visualMode = a.slice('--visual-mode='.length); return 1; }
  if (a === '--visual-trace' && args[i + 1]) { options.visualTrace = args[i + 1]; return 2; }
  if (a.startsWith('--visual-trace=')) { options.visualTrace = a.slice('--visual-trace='.length); return 1; }
  if (a === '--visual-record') {
    if (args[i + 1] && !args[i + 1].startsWith('-')) { options.visualRecord = args[i + 1]; return 2; }
    options.visualRecord = true; return 1;
  }
  if (a.startsWith('--visual-record=')) { options.visualRecord = a.slice('--visual-record='.length); return 1; }
  if (a === '--no-visual-record') { options.visualRecord = false; return 1; }
  if (a === '--visual-list-stride' && args[i + 1]) { options.visualListStride = args[i + 1]; return 2; }
  if (a.startsWith('--visual-list-stride=')) { options.visualListStride = a.slice('--visual-list-stride='.length); return 1; }
  if (a === '--visual-prefix' && args[i + 1]) { options.visualPrefix = args[i + 1]; return 2; }
  if (a.startsWith('--visual-prefix=')) { options.visualPrefix = a.slice('--visual-prefix='.length); return 1; }
  if (a === '--redact-rect' && args[i + 1]) {
    options.redactRect = options.redactRect || [];
    options.redactRect.push(args[i + 1]);
    return 2;
  }
  if (a.startsWith('--redact-rect=')) {
    options.redactRect = options.redactRect || [];
    options.redactRect.push(a.slice('--redact-rect='.length));
    return 1;
  }
  if (a === '--redact-selector' && args[i + 1]) {
    options.redactSelector = options.redactSelector || [];
    options.redactSelector.push(args[i + 1]);
    return 2;
  }
  if (a.startsWith('--redact-selector=')) {
    options.redactSelector = options.redactSelector || [];
    options.redactSelector.push(a.slice('--redact-selector='.length));
    return 1;
  }
  if (a === '--redact-config' && args[i + 1]) { options.redactConfig = args[i + 1]; return 2; }
  if (a.startsWith('--redact-config=')) { options.redactConfig = a.slice('--redact-config='.length); return 1; }
  // post-2.7.0 deprecated frame-related flags: parse but don't act on them.
  // parseVisualFlags will detect their presence on `options` and surface them via
  // deprecatedFlags so warnDeprecatedFlagsOnce can warn the user once on stderr.
  if (a === '--visual-record-frames' && args[i + 1]) { options.visualRecordFrames = args[i + 1]; return 2; }
  if (a.startsWith('--visual-record-frames=')) { options.visualRecordFrames = a.slice('--visual-record-frames='.length); return 1; }
  if (a === '--no-visual-record-frames') { options.visualRecordFrames = false; return 1; }
  if (a === '--visual-frames-throttle' && args[i + 1]) { options.visualFramesThrottle = args[i + 1]; return 2; }
  if (a.startsWith('--visual-frames-throttle=')) { options.visualFramesThrottle = a.slice('--visual-frames-throttle='.length); return 1; }
  return 0;
}

/**
 * 把 options.visual* 字段过 parseVisualFlags，返回透传给 api 的 visual 选项。
 * @param {object} options - parseArgs 输出
 * @returns {{ config, tracePath, recordDir, deprecatedFlags }}
 */
function resolveVisualOptions(options){
  const { config, tracePath, recordDir, deprecatedFlags } = parseVisualFlags(options || {}, BROWSER_VISUAL_DEFAULTS);
  return { config, tracePath, recordDir, deprecatedFlags: deprecatedFlags || [] };
}

const VISUAL_HELP_LINES = [
  '  --visual / --no-visual           开/关页面内视觉反馈（默认开）',
  '  --visual-detail compact|staged   反馈细节级别（默认 staged）',
  '  --visual-ms <n>                  flash 持续时长 ms（默认 420，120-4000）',
  '  --visual-hud / --no-visual-hud   右上角 HUD 卡片（默认开；v0.6.0 取代 --visual-mode hud/dom）',
  '  --visual-flash / --no-visual-flash 元素 flash overlay/relation（默认开）',
  '  --visual-trace <file.jsonl>      把视觉事件落 jsonl（单文件）',
  '  --visual-record [dir]            把事件落到会话包目录（meta+events.jsonl，给 hyperframes 渲视频）',
  '  --no-visual-record               显式关闭会话包',
  '  --visual-list-stride <ms>        列表呼吸感步进（默认 90）',
  '  --visual-prefix <p>              DOM id 前缀（默认 __jse_browser_visual_）',
  '',
  'Deprecated (post-2.7.0 architecture pivot — parsed but ignored):',
  '  --redact-rect / --redact-selector / --redact-config (PNG / 马赛克 链路下线)',
  '  --visual-record-frames / --visual-frames-throttle  (frames/ 目录不再写)',
  '  --visual-mode auto|dom|hud|both|off  (v0.6.0 拆成 --visual-hud / --visual-flash)',
];

function _resetWarnedFlagsForTesting(){ _warnedFlags.clear(); }

module.exports = {
  applyVisualArgs,
  resolveVisualOptions,
  warnDeprecatedFlagsOnce,
  BROWSER_VISUAL_DEFAULTS,
  VISUAL_HELP_LINES,
  _resetWarnedFlagsForTesting,
};
