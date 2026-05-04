'use strict';

const fs = require('fs');
const path = require('path');

// @js-eyes/visual-bridge-kit · node/visualConfig.js
// ---------------------------------------------------------------------------
// 把 CLI 旋钮（已 parseArgv 过的 opts 对象）转成 bridge 能理解的 config。
//
// 输入：
//   opts.visual              boolean? 显式开/关（总开关，落到 config.enabled）
//   opts.visualDetail        'compact' | 'staged'
//   opts.visualMs            number 毫秒（v0.7 deprecated，改名 visualFlashMs；仍接收并映射）
//   opts.visualFlashMs       number 毫秒（v0.7+，pending tone 的 flash timeout）
//   opts.visualLingerMs      number 毫秒（v0.7+，success/info/warn tone 的 linger timeout）
//   opts.visualPinnedHold    'next-call' | 'manual'（v0.7+，pinned 何时被清）
//   opts.visualErrorPin      boolean? error tone 是否自动升级到 pinned（默认 true）
//   opts.visualStaggerFadein boolean? 列表 stagger 是否走 CSS animation-delay 呼吸感
//   opts.visualScrollSettleMs number 毫秒（v0.7+，stagger phase B scrollIntoView 后等 settle）
//   opts.visualHud           boolean? 是否显示右上角 HUD 卡片（默认 true）
//   opts.visualFlash         boolean? 是否在元素上画 flash overlay/relation（默认 true）
//   opts.visualTrace         string 文件路径，启用 jsonl trace（单文件）
//   opts.visualRecord        string 目录路径，启用会话包（events.jsonl + meta.json）
//                            布尔 true 时使用默认目录 runs/sess-<ts>-<rand>/
//   opts.visualListStride    number 列表呼吸感步进 ms（仅 staggerFadeIn=true 时生效）
//   opts.visualPrefix        string DOM id 前缀（便于多 skill 共存）
//
// !! deprecated（post-2.7.0 architecture pivot）!!
//   opts.redactRect / redactRects        曾用于在 PNG 上贴马赛克
//   opts.redactSelector / redactSelectors 曾用于裁掉敏感选择器
//   opts.redactConfig                     曾用于从 JSON 文件载入 redact 规则
//   opts.visualRecordFrames / opts.visualFramesThrottle 曾用于控制 PNG 节流
//
// !! BREAKING（v0.6.0）!!
//   opts.visualMode  'auto'|'dom'|'hud'|'both'|'off' 已硬切；命中即列入 deprecatedFlags 并忽略。
//                    旧映射请由 caller 自行展开为 visual / visualHud / visualFlash 组合：
//                      auto / both → visualHud=true,  visualFlash=true   (默认)
//                      dom         → visualHud=false, visualFlash=true
//                      hud         → visualHud=true,  visualFlash=false
//                      off         → visual=false
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
  durationMs: 420,         // v0.7+ alias of flashMs（保持向后兼容字段名）
  flashMs: 420,            // v0.7: lifetime='flash' timeout（pending tone 一闪）
  lingerMs: 5000,          // v0.7: lifetime='linger' timeout（success tone 默认）
  pinnedHold: 'next-call', // v0.7: 'next-call' | 'manual'，pinned 何时被清
  errorAsPinned: true,     // v0.7: error tone 是否自动升级到 pinned
  scrollSettleMs: 80,      // v0.7: stagger phase B scrollIntoView 后等 layout settle
  staggerFadeIn: false,    // v0.7: phase C 呼吸感（CSS animation-delay）
  detailLevel: 'staged',
  hud: true,
  flash: true,
  prefix: '__jse_visual_',
  listStrideMs: 90,        // v0.7: 仅在 staggerFadeIn=true 时作为 CSS animation-delay 步进
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

// v0.7: profile 预设入口（占位，下一版引入 demo/observe/debug 三档）
//   parseVisualFlags(opts, siteDefaults) 仍是主 API；siteDefaults 之上叠 opts。
function parseVisualFlags(opts, siteDefaults){
  const o = opts || {};
  const out = Object.assign({}, DEFAULTS, siteDefaults || {});

  if (typeof o.visual === 'boolean') out.enabled = o.visual;

  if (o.visualDetail === 'compact' || o.visualDetail === 'staged') {
    out.detailLevel = o.visualDetail;
  }

  // v0.7: visualFlashMs 是新名字；visualMs 仍接收（CLI 层会单独打 deprecation hint）
  // 两者写到同一个字段（durationMs / flashMs），bridge 端 setConfig 会同步两个 alias。
  let flashMs = null;
  if (o.visualMs != null) {
    const n = Number(o.visualMs);
    if (Number.isFinite(n) && n > 0) flashMs = clamp(Math.round(n), 120, 4000);
  }
  if (o.visualFlashMs != null) {
    const n = Number(o.visualFlashMs);
    if (Number.isFinite(n) && n > 0) flashMs = clamp(Math.round(n), 120, 4000);
  }
  if (flashMs != null) {
    out.durationMs = flashMs;
    out.flashMs = flashMs;
  }

  if (o.visualLingerMs != null) {
    const n = Number(o.visualLingerMs);
    if (Number.isFinite(n) && n >= 0) out.lingerMs = clamp(Math.round(n), 0, 60000);
  }

  if (o.visualPinnedHold === 'next-call' || o.visualPinnedHold === 'manual') {
    out.pinnedHold = o.visualPinnedHold;
  }
  if (typeof o.visualErrorPin === 'boolean') out.errorAsPinned = o.visualErrorPin;

  if (o.visualScrollSettleMs != null) {
    const n = Number(o.visualScrollSettleMs);
    if (Number.isFinite(n) && n >= 0) out.scrollSettleMs = clamp(Math.round(n), 0, 2000);
  }
  if (typeof o.visualStaggerFadein === 'boolean') out.staggerFadeIn = o.visualStaggerFadein;

  if (typeof o.visualHud === 'boolean') out.hud = o.visualHud;
  if (typeof o.visualFlash === 'boolean') out.flash = o.visualFlash;

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
  // v0.6.0 BREAKING：--visual-mode 已拆成 --visual-hud / --visual-flash
  if (o.visualMode != null) deprecatedFlags.push('--visual-mode');
  // v0.7.0 soft-deprecated：--visual-ms 改名 --visual-flash-ms（仍接收，仅打 hint）
  if (o.visualMs != null && o.visualFlashMs == null) deprecatedFlags.push('--visual-ms');

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
