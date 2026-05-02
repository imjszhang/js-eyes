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
//   --visual-mode auto|dom|hud|both|off
//   --visual-trace <file>    把事件写入 jsonl
//   --visual-list-stride <ms>
//   --visual-prefix <p>      DOM id 前缀（默认 __jse_browser_visual_）
//
// 提供两个 helper：
//   - applyVisualArgs(args, i, options)  在 parseArgs 循环里识别 visual flag，
//                                          返回消耗的 argv 步数（0 表示不是 visual flag）
//   - resolveVisualOptions(options)      把 options.visual* 字段过 parseVisualFlags，
//                                          返回 { visual: { config, tracePath } } 透传给 api
// ---------------------------------------------------------------------------

const { parseVisualFlags } = require('@js-eyes/visual-bridge-kit');

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
  if (a === '--visual-mode' && args[i + 1]) { options.visualMode = args[i + 1]; return 2; }
  if (a.startsWith('--visual-mode=')) { options.visualMode = a.slice('--visual-mode='.length); return 1; }
  if (a === '--visual-trace' && args[i + 1]) { options.visualTrace = args[i + 1]; return 2; }
  if (a.startsWith('--visual-trace=')) { options.visualTrace = a.slice('--visual-trace='.length); return 1; }
  if (a === '--visual-list-stride' && args[i + 1]) { options.visualListStride = args[i + 1]; return 2; }
  if (a.startsWith('--visual-list-stride=')) { options.visualListStride = a.slice('--visual-list-stride='.length); return 1; }
  if (a === '--visual-prefix' && args[i + 1]) { options.visualPrefix = args[i + 1]; return 2; }
  if (a.startsWith('--visual-prefix=')) { options.visualPrefix = a.slice('--visual-prefix='.length); return 1; }
  return 0;
}

/**
 * 把 options.visual* 字段过 parseVisualFlags，返回透传给 api 的 visual 选项。
 * @param {object} options - parseArgs 输出
 * @returns {{ config: object, tracePath: string|null }}
 */
function resolveVisualOptions(options){
  const { config, tracePath } = parseVisualFlags(options || {}, BROWSER_VISUAL_DEFAULTS);
  return { config, tracePath };
}

const VISUAL_HELP_LINES = [
  '  --visual / --no-visual           开/关页面内视觉反馈（默认开）',
  '  --visual-detail compact|staged   反馈细节级别（默认 staged）',
  '  --visual-ms <n>                  flash 持续时长 ms（默认 420，120-4000）',
  '  --visual-mode auto|dom|hud|both|off  锚点解析策略（默认 auto）',
  '  --visual-trace <file.jsonl>      把视觉事件落 jsonl',
  '  --visual-list-stride <ms>        列表呼吸感步进（默认 90）',
  '  --visual-prefix <p>              DOM id 前缀（默认 __jse_browser_visual_）',
];

module.exports = {
  applyVisualArgs,
  resolveVisualOptions,
  BROWSER_VISUAL_DEFAULTS,
  VISUAL_HELP_LINES,
};
