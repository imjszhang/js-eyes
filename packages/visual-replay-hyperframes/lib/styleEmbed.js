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
 * post-2.7.0 architecture pivot：composition 不再依赖 PNG/帧序列/绝对像素坐标。
 * 全部样式按 vw / clamp / max-width 适配响应式，flash 通过 .flash-active 类切换
 * 实现 outline 动画（不依赖 DOM 测量）。
 */
function getCompositionExtraCss(){
  return [
    /* base */
    'body { margin: 0; background: #0e1116; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }',
    '* { box-sizing: border-box; }',
    '#stage { position: relative; min-height: 100vh; padding: 4vh 4vw 6vh; background: linear-gradient(160deg, #0e1116 0%, #161b22 60%, #1a1f27 100%); }',
    '#stage::before { content: ""; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(circle at 80% 0%, rgba(22,119,255,0.10), transparent 60%); }',

    /* reddit-stage 容器 */
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

    /* item-info / global card */
    '.reddit-info-card { background: #1a1f27; border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 18px 22px; max-width: 760px; margin: 0 auto; transition: outline 200ms ease, box-shadow 220ms ease, transform 240ms ease; outline: 2px solid transparent; outline-offset: 2px; }',
    '.reddit-info-card .summary { margin: 0 0 12px; font-size: 14px; line-height: 1.55; color: rgba(240,246,252,0.78); }',
    '.reddit-info-card .kv-grid { display: grid; grid-template-columns: 140px 1fr; row-gap: 6px; column-gap: 14px; margin: 0; font-size: 13px; }',
    '.reddit-info-card .kv-row { display: contents; }',
    '.reddit-info-card .kv-row dt { color: rgba(240,246,252,0.5); font-weight: 600; }',
    '.reddit-info-card .kv-row dd { margin: 0; color: #f0f6fc; word-break: break-word; }',
    '.reddit-info-card .empty-hint { font-size: 12px; color: rgba(240,246,252,0.4); }',

    /* nav card */
    '.reddit-nav-card { display: grid; grid-template-columns: 60px 1fr; gap: 14px; align-items: center; max-width: 760px; margin: 8vh auto 0; padding: 22px 26px; background: linear-gradient(135deg, rgba(22,119,255,0.18), rgba(22,119,255,0.04)); border: 1px solid rgba(22,119,255,0.36); border-radius: 12px; transition: outline 200ms ease, box-shadow 220ms ease, transform 240ms ease; outline: 2px solid transparent; outline-offset: 2px; }',
    '.reddit-nav-card .nav-arrow { font-size: 36px; color: #58a6ff; text-align: center; }',
    '.reddit-nav-card .nav-pair { display: flex; flex-direction: column; gap: 8px; min-width: 0; }',
    '.reddit-nav-card .nav-row { display: flex; gap: 10px; min-width: 0; align-items: baseline; }',
    '.reddit-nav-card .nav-row.to .nav-url { color: #58a6ff; font-weight: 600; }',
    '.reddit-nav-card .nav-label { font-size: 11px; color: rgba(240,246,252,0.5); text-transform: uppercase; letter-spacing: 0.08em; flex: 0 0 36px; }',
    '.reddit-nav-card .nav-url { flex: 1 1 auto; font-family: "SF Mono", ui-monospace, monospace; font-size: 13px; color: rgba(240,246,252,0.85); overflow-wrap: anywhere; }',
    '.reddit-nav-card .nav-footer { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); margin-top: 4px; }',
    '.reddit-nav-card .nav-tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(22,119,255,0.2); color: #91c4ff; font-weight: 600; letter-spacing: 0.05em; }',
    '.reddit-nav-card .nav-action { font-size: 12px; color: rgba(240,246,252,0.6); }',

    /* tree */
    '.reddit-comment-tree { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-width: 880px; margin-inline: auto; }',
    '.comment-node { position: relative; padding: 10px 14px 10px calc(20px + var(--depth, 0) * 16px); background: #1a1f27; border-left: 2px solid rgba(255,255,255,0.08); border-radius: 0 6px 6px 0; transition: outline 180ms ease, box-shadow 200ms ease, transform 220ms ease; outline: 2px solid transparent; outline-offset: 2px; }',
    '.comment-node[style*="--depth:0"] { border-left-color: rgba(22,119,255,0.45); }',
    '.comment-node .comment-spine { position: absolute; left: calc(8px + var(--depth, 0) * 16px); top: 12px; bottom: 12px; width: 2px; background: rgba(255,255,255,0.05); }',
    '.comment-node .comment-head { display: flex; gap: 12px; font-size: 12px; color: rgba(240,246,252,0.55); margin-bottom: 4px; }',
    '.comment-node .comment-head .author { color: #58a6ff; font-weight: 600; }',
    '.comment-node .comment-head .comment-score { color: rgba(240,246,252,0.7); }',
    '.comment-node .comment-text { margin: 0; font-size: 13px; line-height: 1.5; color: #f0f6fc; word-break: break-word; }',
    '.empty-hint { padding: 20px; text-align: center; color: rgba(240,246,252,0.4); font-size: 13px; }',

    /* HUD card：右上角，固定屏幕坐标 */
    '.jse-hud { position: fixed; top: 24px; right: 24px; min-width: 240px; max-width: 360px; padding: 14px 18px; background: rgba(20,25,33,0.92); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.4); color: #f0f6fc; opacity: 0; transform: translateY(-8px); pointer-events: none; z-index: 1000; }',
    '.jse-hud .hud-action { font-size: 13px; font-weight: 700; color: #f0f6fc; margin: 0 0 4px; word-break: break-word; }',
    '.jse-hud .hud-target { font-size: 12px; color: rgba(240,246,252,0.7); margin: 0 0 4px; word-break: break-word; }',
    '.jse-hud .hud-detail { font-size: 11px; color: rgba(240,246,252,0.5); margin: 0; }',
    '.jse-hud[data-tone="success"] { border-color: rgba(82,196,26,0.5); }',
    '.jse-hud[data-tone="success"] .hud-action { color: #b6f0a3; }',
    '.jse-hud[data-tone="error"], .jse-hud[data-tone="danger"] { border-color: rgba(255,77,79,0.55); }',
    '.jse-hud[data-tone="error"] .hud-action, .jse-hud[data-tone="danger"] .hud-action { color: #ffb3b5; }',
    '.jse-hud[data-tone="pending"], .jse-hud[data-tone="warn"] { border-color: rgba(250,173,20,0.5); }',
    '.jse-hud[data-tone="pending"] .hud-action, .jse-hud[data-tone="warn"] .hud-action { color: #ffd966; }',

    /* card 入场（由 timelineScript 在 before 时刻 add .card-active） */
    '.reddit-card.card-active, .reddit-info-card.card-active, .reddit-nav-card.card-active, .comment-node.card-active { opacity: 1; transform: translateY(0); }',

    /* flash outline 动画：timelineScript 在 flash 时刻 add .flash-active，duration 后 remove */
    '@keyframes jse-flash-pulse { 0% { outline-width: 2px; outline-color: rgba(22,119,255,0); box-shadow: 0 0 0 0 rgba(22,119,255,0); } 35% { outline-width: 4px; outline-color: rgba(22,119,255,0.85); box-shadow: 0 0 0 6px rgba(22,119,255,0.18); } 100% { outline-width: 2px; outline-color: rgba(22,119,255,0); box-shadow: 0 0 0 0 rgba(22,119,255,0); } }',
    '@keyframes jse-flash-pulse-success { 0% { outline-color: rgba(82,196,26,0); box-shadow: 0 0 0 0 rgba(82,196,26,0); } 35% { outline-color: rgba(82,196,26,0.9); box-shadow: 0 0 0 6px rgba(82,196,26,0.2); } 100% { outline-color: rgba(82,196,26,0); box-shadow: 0 0 0 0 rgba(82,196,26,0); } }',
    '@keyframes jse-flash-pulse-error { 0% { outline-color: rgba(255,77,79,0); box-shadow: 0 0 0 0 rgba(255,77,79,0); } 35% { outline-color: rgba(255,77,79,0.9); box-shadow: 0 0 0 6px rgba(255,77,79,0.22); } 100% { outline-color: rgba(255,77,79,0); box-shadow: 0 0 0 0 rgba(255,77,79,0); } }',
    '@keyframes jse-flash-pulse-pending { 0% { outline-color: rgba(250,173,20,0); box-shadow: 0 0 0 0 rgba(250,173,20,0); } 35% { outline-color: rgba(250,173,20,0.9); box-shadow: 0 0 0 6px rgba(250,173,20,0.22); } 100% { outline-color: rgba(250,173,20,0); box-shadow: 0 0 0 0 rgba(250,173,20,0); } }',
    '.flash-active { animation: jse-flash-pulse 600ms ease-out; outline: 2px solid rgba(22,119,255,0.85); outline-offset: 2px; }',
    '.flash-active[data-tone="success"], .flash-active.tone-success { animation: jse-flash-pulse-success 600ms ease-out; outline-color: rgba(82,196,26,0.85); }',
    '.flash-active[data-tone="error"], .flash-active.tone-error, .flash-active[data-tone="danger"], .flash-active.tone-danger { animation: jse-flash-pulse-error 600ms ease-out; outline-color: rgba(255,77,79,0.85); }',
    '.flash-active[data-tone="pending"], .flash-active.tone-pending, .flash-active[data-tone="warn"], .flash-active.tone-warn { animation: jse-flash-pulse-pending 600ms ease-out; outline-color: rgba(250,173,20,0.85); }',

    /* 进度条 */
    '.jse-progress { position: fixed; left: 0; bottom: 0; height: 3px; width: 100%; background: rgba(255,255,255,0.08); z-index: 999; }',
    '.jse-progress > .bar { height: 100%; width: 0%; background: linear-gradient(90deg, #58a6ff, #1677ff); }',

    /* 水印 */
    '.jse-watermark { position: fixed; left: 16px; bottom: 12px; font: 600 11px/1 -apple-system, system-ui; color: rgba(255,255,255,0.4); letter-spacing: 0.04em; z-index: 998; }',

    /* relation 横线（保留但默认隐藏，给 tree 模板用） */
    '.jse-relation-overlay { position: fixed; inset: 0; pointer-events: none; opacity: 0; z-index: 800; }',
    '.jse-relation-overlay.active { opacity: 1; }',

    /* 响应式：小屏 stage 留白收紧 */
    '@media (max-width: 700px) { #stage { padding: 3vh 4vw 6vh; } .reddit-card { padding: 10px 12px; } .jse-hud { right: 12px; top: 12px; left: 12px; max-width: none; } }',
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
