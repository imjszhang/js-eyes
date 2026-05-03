'use strict';

const fs = require('fs');
const path = require('path');

// @js-eyes/visual-bridge-kit · node/visualConfig.js
// ---------------------------------------------------------------------------
// 把 CLI 旋钮（已 parseArgv 过的 opts 对象）转成 bridge 能理解的 config。
//
// 输入：
//   opts.visual              boolean? 显式开/关
//   opts.visualDetail        'compact' | 'staged'
//   opts.visualMs            number 毫秒
//   opts.visualMode          'auto' | 'dom' | 'hud' | 'both' | 'off'
//   opts.visualTrace         string 文件路径，启用 jsonl trace（单文件）
//   opts.visualRecord        string 目录路径，启用会话包（events.jsonl + meta.json）
//                            布尔 true 时使用默认目录 runs/sess-<ts>-<rand>/
//   opts.visualListStride    number 列表呼吸感步进 ms
//   opts.visualPrefix        string DOM id 前缀（便于多 skill 共存）
//
// !! deprecated（post-2.7.0 architecture pivot）!!
//   opts.redactRect / redactRects        曾用于在 PNG 上贴马赛克
//   opts.redactSelector / redactSelectors 曾用于裁掉敏感选择器
//   opts.redactConfig                     曾用于从 JSON 文件载入 redact 规则
//   opts.visualRecordFrames / opts.visualFramesThrottle 曾用于控制 PNG 节流
// 仍解析（不报错）但不下发：
//   - 主链路不再走 chrome.tabs.captureVisibleTab → frames/<ts>.png 路径
//   - bridge.config 不再注入 redactSelectors（emit 也不带 anchor.rect 了）
//   - meta.json 不再写 redact / frameCount 字段
// 仅当从 require('@js-eyes/visual-bridge-kit/dev') 显式拿 makeFrameWriter 并自行
// 组装 PNG 路线时才需要参考这里的旧字段。
//
// 输出：
//   { config, traceEnabled, tracePath, recordEnabled, recordDir, redact, deprecatedFlags }
//   - redact 仍解析返回，留作 dev 路径取用，主链路不消费
//   - deprecatedFlags：检测到哪些被弃用 flag 被传入，给 CLI 层打印告警
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

function parseRectString(str){
  if (typeof str !== 'string') return null;
  const parts = str.split(',').map(s => Number(s.trim()));
  if (parts.length !== 4) return null;
  if (!parts.every(Number.isFinite)) return null;
  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) return null;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function collectRedact(opts){
  const o = opts || {};
  const rects = [];
  const selectors = [];

  const pushRect = (raw) => {
    if (!raw) return;
    if (typeof raw === 'string') {
      const r = parseRectString(raw);
      if (r) rects.push(r);
    } else if (Array.isArray(raw)) {
      for (const item of raw) pushRect(item);
    } else if (typeof raw === 'object') {
      const x = Number(raw.x), y = Number(raw.y);
      const w = Number(raw.w ?? raw.width), h = Number(raw.h ?? raw.height);
      if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
        rects.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
      }
    }
  };

  const pushSel = (raw) => {
    if (typeof raw === 'string' && raw.trim()) selectors.push(raw.trim());
    else if (Array.isArray(raw)) for (const s of raw) pushSel(s);
  };

  if (o.redactRect != null) pushRect(o.redactRect);
  if (o.redactRects != null) pushRect(o.redactRects);
  if (o.redactSelector != null) pushSel(o.redactSelector);
  if (o.redactSelectors != null) pushSel(o.redactSelectors);

  if (typeof o.redactConfig === 'string' && o.redactConfig.length > 0) {
    const p = path.isAbsolute(o.redactConfig) ? o.redactConfig : path.resolve(process.cwd(), o.redactConfig);
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const json = JSON.parse(raw);
      if (json && typeof json === 'object') {
        if (Array.isArray(json.rects)) pushRect(json.rects);
        if (Array.isArray(json.selectors)) pushSel(json.selectors);
      }
    } catch (_) {
      // 静默忽略；用户的 redact 文件错了不该让录屏崩溃
    }
  }

  // 去重
  const dedupSel = Array.from(new Set(selectors));
  const dedupRect = [];
  const seen = new Set();
  for (const r of rects) {
    const k = r.x + '|' + r.y + '|' + r.w + '|' + r.h;
    if (seen.has(k)) continue;
    seen.add(k);
    dedupRect.push(r);
  }
  return { rects: dedupRect, selectors: dedupSel };
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

  let recordDir = null;
  if (typeof o.visualRecord === 'string' && o.visualRecord.length > 0) {
    recordDir = path.isAbsolute(o.visualRecord) ? o.visualRecord : path.resolve(process.cwd(), o.visualRecord);
  } else if (o.visualRecord === true) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rand = Math.random().toString(36).slice(2, 6);
    recordDir = path.resolve(process.cwd(), 'runs', 'sess-' + ts + '-' + rand);
  }

  // post-2.7.0：redact 规则仍解析（dev/PNG 路径仍可消费），但不再注入到 bridge
  // config（emit 主链路不带 anchor.rect，redactSelectors 失去作用）
  const redact = collectRedact(o);

  // 收集已被 deprecate 的 flag，CLI 层可以基于这个数组打印一次告警
  const deprecatedFlags = [];
  if (o.redactRect != null) deprecatedFlags.push('--redact-rect');
  if (o.redactRects != null) deprecatedFlags.push('--redact-rects');
  if (o.redactSelector != null) deprecatedFlags.push('--redact-selector');
  if (o.redactSelectors != null) deprecatedFlags.push('--redact-selectors');
  if (typeof o.redactConfig === 'string' && o.redactConfig.length > 0) deprecatedFlags.push('--redact-config');
  if (o.visualRecordFrames != null) deprecatedFlags.push('--visual-record-frames');
  if (o.visualFramesThrottle != null) deprecatedFlags.push('--visual-frames-throttle');

  return {
    config: out,
    tracePath,
    traceEnabled: !!tracePath,
    recordDir,
    recordEnabled: !!recordDir,
    redact,
    deprecatedFlags,
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
