'use strict';

// lib/cliVisualFlags.js
// ---------------------------------------------------------------------------
// post-2.7.0 architecture pivot：处理被弃用的可视化相关 CLI flag。
//
// 用法：
//   const { config, deprecatedFlags } = parseVisualFlags(opts, REDDIT_VISUAL_DEFAULTS);
//   warnDeprecatedFlagsOnce(deprecatedFlags);
//
// 弃用的 flag 仍然解析（不抛错、不打断现有脚本），但不再下发到 bridge / translator：
//   --redact-rect / --redact-rects     旧 PNG 截图打码
//   --redact-selector / --redact-selectors
//   --redact-config <path>             同上
//   --visual-record-frames             开关 PNG 截图链路
//   --visual-frames-throttle <n>       PNG 截图节流
//
// 仍生效的 visual flag 见 README / commands.printHelp（--visual / --visual-detail /
// --visual-ms / --visual-hud / --visual-flash / --visual-trace / --visual-record [dir] /
// --visual-list-stride / --visual-prefix）。
//
// v0.6.0 BREAKING：旧 `--visual-mode auto|dom|hud|both|off` 已硬切，命中即列入
// deprecatedFlags 并被忽略；caller 应改用 --visual-hud / --visual-flash 组合。
// ---------------------------------------------------------------------------

const _warnedFlags = new Set();

function warnDeprecatedFlagsOnce(deprecatedFlags){
  if (!Array.isArray(deprecatedFlags) || deprecatedFlags.length === 0) return;
  const fresh = deprecatedFlags.filter((f) => !_warnedFlags.has(f));
  if (fresh.length === 0) return;
  for (const f of fresh) _warnedFlags.add(f);
  const msg = '[js-reddit-ops-skill] deprecated visual flag(s) ignored (post-2.7.0 HTML pivot): '
    + fresh.join(', ')
    + '. PNG screenshot pipeline is no longer in the main path; '
    + 'see CHANGELOG "Architecture pivot (post-2.7.0, in-place)".';
  try { process.stderr.write(msg + '\n'); } catch (_) {}
}

function resetWarnedFlagsForTesting(){
  _warnedFlags.clear();
}

module.exports = {
  warnDeprecatedFlagsOnce,
  resetWarnedFlagsForTesting,
};
