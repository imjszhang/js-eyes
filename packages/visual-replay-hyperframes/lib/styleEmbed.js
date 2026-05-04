'use strict';

const fs = require('fs');
const { STYLES_VISUAL_RUNTIME_CSS_PATH } = require('@js-eyes/visual-bridge-kit');

let cachedRuntime = null;
function loadRuntimeCss(){
  if (cachedRuntime != null) return cachedRuntime;
  try { cachedRuntime = fs.readFileSync(STYLES_VISUAL_RUNTIME_CSS_PATH, 'utf8'); }
  catch (_) { cachedRuntime = ''; }
  return cachedRuntime;
}

/**
 * v0.7.0 plugin-system：composition 样式只保留两条主链路。
 *   - snapshot 主链路：#stage[data-mode="snapshot"] 单图层截屏硬切
 *   - template 兜底：list / item 卡片（_generic + reddit/{list,item} 还会用）
 *
 * 已删除的 CSS（v0.6.x 有，v0.7.0 起搬到对应 plugin）：
 *   - HUD 浮层 CSS（.jse-hud / .hud-action / ...）→ plugins/builtin-hud/style.js
 *   - flash 描边 + keyframes（.flash-active / @keyframes jse-flash-pulse*）→ plugins/builtin-flash/style.js
 *
 * v0.6.0 已删除的（仍然不在）：
 *   - reddit chrome 仿真：.reddit-topbar / .reddit-leftnav / body[data-shell="reddit"]
 *   - page header：.reddit-page-header（含 sub-banner / sort-tabs / user-banner / nav-breadcrumb）
 *   - tree 模板：.reddit-comment-tree / .comment-node
 *   - navigation 模板：.reddit-nav-card
 *   - dom_* 合成动画：.jse-cursor / .jse-click-ripple / .jse-spinner / .jse-typing-caret
 *   - 旧的 frames 段隐 chrome 规则：body[data-frames="present"]
 */
function getCompositionExtraCss(){
  return [
    /* base */
    'body { margin: 0; background: #0e1116; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }',
    '* { box-sizing: border-box; }',
    '#stage { position: relative; min-height: 100vh; padding: 4vh 4vw 6vh; background: linear-gradient(160deg, #0e1116 0%, #161b22 60%, #1a1f27 100%); }',
    '#stage::before { content: ""; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(circle at 80% 0%, rgba(22,119,255,0.10), transparent 60%); }',

    /* reddit-stage 容器（template mode list/item 用） */
    '.reddit-stage { position: relative; max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; gap: clamp(10px, 1.4vw, 18px); }',
    '.reddit-stage-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; padding: 4px 0 8px; border-bottom: 1px solid rgba(255,255,255,0.08); }',
    '.reddit-stage-head .sub-title { margin: 0; font-size: clamp(20px, 2.4vw, 30px); font-weight: 700; color: #f0f6fc; letter-spacing: -0.01em; }',
    '.reddit-stage-head .sort-tag, .reddit-stage-head .count-tag { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,0.06); color: rgba(240,246,252,0.75); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }',

    /* reddit card list */
    '.reddit-card-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: clamp(8px, 1.1vw, 14px); }',
    '.reddit-card-list.single { display: block; }',
    '.reddit-card-list > li { list-style: none; }',

    /* reddit-card */
    '.reddit-card { display: grid; grid-template-columns: 56px 1fr; gap: 12px; background: #1a1f27; border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 12px 16px; transition: outline 200ms ease, box-shadow 220ms ease, transform 240ms ease, background 220ms ease; outline: 2px solid transparent; outline-offset: 2px; }',
    '.reddit-card .card-aside { display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 4px; color: rgba(255,255,255,0.55); }',
    '.reddit-card .card-aside .vote-up, .reddit-card .card-aside .vote-dn { font-size: 14px; line-height: 1; opacity: 0.6; }',
    '.reddit-card .card-aside .score { font-size: 14px; font-weight: 700; color: #f0f6fc; line-height: 1; }',
    '.reddit-card .card-main { min-width: 0; }',
    '.reddit-card .card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: rgba(240,246,252,0.6); margin-bottom: 6px; }',
    '.reddit-card .card-head .sub-pill { color: #58a6ff; font-weight: 700; }',
    '.reddit-card .card-head .by em { color: rgba(240,246,252,0.78); font-style: normal; font-weight: 600; }',
    '.reddit-card .card-head .flair { padding: 1px 8px; border-radius: 999px; background: rgba(22,119,255,0.18); color: #91c4ff; font-size: 11px; }',
    '.reddit-card .card-head .time { color: rgba(240,246,252,0.45); }',
    '.reddit-card .title { margin: 0 0 6px; font-size: clamp(14px, 1.45vw, 17px); line-height: 1.35; color: #f0f6fc; font-weight: 600; word-break: break-word; }',
    '.reddit-card .preview { margin: 0 0 8px; font-size: 13px; line-height: 1.45; color: rgba(240,246,252,0.6); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }',
    '.reddit-card .card-foot { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 12px; color: rgba(240,246,252,0.55); font-weight: 600; }',
    '.reddit-card .card-foot .fullname { margin-left: auto; font-family: "SF Mono", ui-monospace, monospace; font-size: 11px; color: rgba(240,246,252,0.32); }',

    /* item-info / global card（reddit/item.js + _generic/genericKv 共用） */
    '.reddit-info-card { background: #1a1f27; border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 18px 22px; max-width: 760px; margin: 0 auto; transition: outline 200ms ease, box-shadow 220ms ease, transform 240ms ease; outline: 2px solid transparent; outline-offset: 2px; }',
    '.reddit-info-card .summary { margin: 0 0 12px; font-size: 14px; line-height: 1.55; color: rgba(240,246,252,0.78); }',
    '.reddit-info-card .hero-metric { display: flex; align-items: baseline; gap: 12px; margin: 4px 0 16px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }',
    '.reddit-info-card .hero-metric .hero-num { font-size: clamp(2.2rem, 5vw, 3.4rem); font-weight: 700; color: #58a6ff; line-height: 1; letter-spacing: -0.02em; }',
    '.reddit-info-card .hero-metric .hero-label { font-size: 11px; font-weight: 600; color: rgba(240,246,252,0.55); text-transform: uppercase; letter-spacing: 0.08em; }',
    '.reddit-info-card .kv-grid { display: grid; grid-template-columns: 140px 1fr; row-gap: 6px; column-gap: 14px; margin: 0; font-size: 13px; }',
    '.reddit-info-card .kv-row { display: contents; }',
    '.reddit-info-card .kv-row dt { color: rgba(240,246,252,0.5); font-weight: 600; }',
    '.reddit-info-card .kv-row dd { margin: 0; color: #f0f6fc; word-break: break-word; }',
    '.reddit-info-card .empty-hint { font-size: 12px; color: rgba(240,246,252,0.4); }',
    '.empty-hint { padding: 20px; text-align: center; color: rgba(240,246,252,0.4); font-size: 13px; }',

    /* card 入场（template mode 兜底卡片） */
    '.reddit-card.card-active, .reddit-info-card.card-active { opacity: 1; transform: translateY(0); }',

    /* 进度条 */
    '.jse-progress { position: fixed; left: 0; bottom: 0; height: 3px; width: 100%; background: rgba(255,255,255,0.08); z-index: 999; }',
    '.jse-progress > .bar { height: 100%; width: 0%; background: linear-gradient(90deg, #58a6ff, #1677ff); }',

    /* 水印 */
    '.jse-watermark { position: fixed; left: 16px; bottom: 12px; font: 600 11px/1 -apple-system, system-ui; color: rgba(255,255,255,0.4); letter-spacing: 0.04em; z-index: 998; }',

    /* 响应式：小屏 stage 留白收紧（HUD 小屏规则随 plugin 走） */
    '@media (max-width: 700px) { #stage { padding: 3vh 4vw 6vh; } .reddit-card { padding: 10px 12px; } }',

    /* ===========================================================
       snapshot mode：单图层 .jse-frame-img-cur，按时间轴硬切 background-image
       （无淡入淡出，贴近真实浏览器）。
       =========================================================== */
    '#stage[data-mode="snapshot"] { padding: 0; min-height: 100vh; background: #0e1116; display: flex; align-items: stretch; justify-content: center; overflow: hidden; }',
    '#stage[data-mode="snapshot"]::before { display: none; }',
    '#stage[data-mode="snapshot"] .jse-frame-img-cur { position: absolute; inset: 0; background-color: #0e1116; background-size: contain; background-position: top center; background-repeat: no-repeat; }',
    /* snapshot stage 容纳真实 reddit 截图，整张图当背景；卡片层默认隐藏 */
    '#stage[data-mode="snapshot"] > .reddit-stage, #stage[data-mode="snapshot"] > .reddit-info-card, #stage[data-mode="snapshot"] > .card-stage { display: none; }',
  ].join('\n');
}

function buildStyleBlock(){
  return [
    '<style>',
    loadRuntimeCss(),
    getCompositionExtraCss(),
    '</style>',
  ].join('\n');
}

module.exports = { loadRuntimeCss, getCompositionExtraCss, buildStyleBlock };
