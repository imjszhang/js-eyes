'use strict';

// @js-eyes/visual-bridge-kit · node/visualConfig.js
// ---------------------------------------------------------------------------
// 把 CLI 旋钮（已 parseArgv 过的 opts 对象）转成 bridge 能理解的 config。
//
// 输入：
//   opts.visual              boolean? 显式开/关
//   opts.visualDetail        'compact' | 'staged'
//   opts.visualMs            number 毫秒
//   opts.visualMode          'auto' | 'dom' | 'hud' | 'both' | 'off'
//   opts.visualTrace         string 文件路径，启用 jsonl trace
//   opts.visualListStride    number 列表呼吸感步进 ms
//   opts.visualPrefix        string DOM id 前缀（便于多 skill 共存）
//
// 输出：
//   { config, traceEnabled, tracePath }
// ---------------------------------------------------------------------------

const DEFAULTS = Object.freeze({
  enabled: true,
  durationMs: 420,
  detailLevel: 'staged',
  mode: 'auto',
  prefix: '__jse_visual_',
  listStrideMs: 90,
});

function clamp(n, lo, hi){
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function parseVisualFlags(opts, siteDefaults){
  const o = opts || {};
  const out = Object.assign({}, DEFAULTS, siteDefaults || {});

  if (typeof o.visual === 'boolean') out.enabled = o.visual;

  if (o.visualDetail === 'compact' || o.visualDetail === 'staged') {
    out.detailLevel = o.visualDetail;
  }

  if (o.visualMs != null) {
    const n = Number(o.visualMs);
    if (Number.isFinite(n) && n > 0) out.durationMs = clamp(Math.round(n), 120, 4000);
  }

  if (typeof o.visualMode === 'string') {
    const m = o.visualMode.toLowerCase();
    if (m === 'auto' || m === 'dom' || m === 'hud' || m === 'both' || m === 'off') {
      out.mode = m;
    }
  }

  if (o.visualListStride != null) {
    const n = Number(o.visualListStride);
    if (Number.isFinite(n) && n >= 0) out.listStrideMs = clamp(Math.round(n), 0, 1000);
  }

  if (typeof o.visualPrefix === 'string' && o.visualPrefix.length > 0 && o.visualPrefix.length < 64) {
    out.prefix = o.visualPrefix;
  }

  const tracePath = (typeof o.visualTrace === 'string' && o.visualTrace.length > 0) ? o.visualTrace : null;

  return {
    config: out,
    tracePath,
    traceEnabled: !!tracePath,
  };
}

function injectBridgeConfigSnippet(visualConfig){
  // 返回一段 JS 字符串，bridge 注入完成后 callRaw 即可生效。
  // 形如 (window.__jse_visual && window.__jse_visual.config({...})) || null
  const json = JSON.stringify(visualConfig || {});
  return '(window.__jse_visual && window.__jse_visual.config(' + json + ')) || null';
}

module.exports = {
  DEFAULTS,
  parseVisualFlags,
  injectBridgeConfigSnippet,
};
