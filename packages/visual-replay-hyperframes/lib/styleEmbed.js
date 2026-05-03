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
    '.reddit-info-card .hero-metric { display: flex; align-items: baseline; gap: 12px; margin: 4px 0 16px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }',
    '.reddit-info-card .hero-metric .hero-num { font-size: clamp(2.2rem, 5vw, 3.4rem); font-weight: 700; color: #58a6ff; line-height: 1; letter-spacing: -0.02em; }',
    '.reddit-info-card .hero-metric .hero-label { font-size: 11px; font-weight: 600; color: rgba(240,246,252,0.55); text-transform: uppercase; letter-spacing: 0.08em; }',
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

    /* ===========================================================
       v0.3.0 reddit page shell 样式（仅 body[data-shell="reddit"] 启用，
       非 reddit skill 的老 session 重渲零回归）
       =========================================================== */

    /* body 整体配色统一调到 reddit 浅色风（与 chrome 协调）。
       注意：保持深色舞台主区让卡片可读，shell 用浅灰 chrome 视觉差。 */
    'body[data-shell="reddit"] { background: #1a1a1b; color: #d7dadc; }',
    'body[data-shell="reddit"] #reddit-shell { display: grid; grid-template-rows: 56px 1fr; grid-template-columns: 240px minmax(0, 1fr); grid-template-areas: "topbar topbar" "leftnav content"; min-height: 100vh; }',
    'body[data-shell="reddit"] #stage { grid-area: content; min-height: calc(100vh - 56px); padding: 24px clamp(16px, 3vw, 32px) 80px; background: linear-gradient(180deg, #161617 0%, #1a1a1b 60%, #1a1a1b 100%); border-left: 1px solid rgba(255,255,255,0.04); }',
    'body[data-shell="reddit"] #stage::before { display: none; }',

    /* topbar */
    '.reddit-topbar { grid-area: topbar; display: flex; align-items: center; gap: 16px; padding: 0 16px; height: 56px; background: #1a1a1b; border-bottom: 1px solid rgba(255,255,255,0.08); position: sticky; top: 0; z-index: 100; }',
    '.reddit-topbar .brand { display: flex; align-items: center; gap: 8px; text-decoration: none; color: #ffffff; min-width: 220px; }',
    '.reddit-topbar .brand-logo { flex: 0 0 32px; }',
    '.reddit-topbar .brand-name { font-weight: 800; font-size: 18px; letter-spacing: -0.02em; color: #d7dadc; }',
    '.reddit-topbar .topbar-search-wrap { position: relative; flex: 1 1 auto; max-width: 640px; }',
    '.reddit-topbar .topbar-search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: rgba(215,218,220,0.55); font-size: 16px; pointer-events: none; }',
    '.reddit-topbar .topbar-search { width: 100%; height: 40px; padding: 0 16px 0 38px; border: 1px solid rgba(255,255,255,0.10); border-radius: 999px; background: #272729; color: #d7dadc; font-size: 14px; outline: none; transition: border-color 200ms ease, background 200ms ease; }',
    '.reddit-topbar .topbar-search::placeholder { color: rgba(215,218,220,0.45); }',
    '.reddit-topbar .topbar-search:not(:placeholder-shown) { border-color: rgba(217, 57, 0, 0.55); background: #2a2a2c; }',
    '.reddit-topbar .topbar-actions { display: flex; align-items: center; gap: 12px; }',
    '.reddit-topbar .topbar-create { display: flex; align-items: center; gap: 6px; padding: 6px 14px 6px 10px; background: transparent; border: 1px solid rgba(255,255,255,0.18); border-radius: 999px; color: #d7dadc; font-size: 13px; font-weight: 600; cursor: default; }',
    '.reddit-topbar .topbar-create .create-glyph { font-size: 16px; line-height: 1; color: #d93900; font-weight: 800; }',
    '.reddit-topbar .topbar-avatar { display: flex; align-items: center; gap: 8px; padding: 4px 10px 4px 6px; border: 1px solid rgba(255,255,255,0.12); border-radius: 999px; background: rgba(255,255,255,0.04); }',
    '.reddit-topbar .topbar-avatar .avatar-dot { width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, #d93900, #ff6a00); }',
    '.reddit-topbar .topbar-avatar .avatar-name { font-size: 12px; font-weight: 600; color: #d7dadc; max-width: 110px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',

    /* leftnav */
    '.reddit-leftnav { grid-area: leftnav; padding: 16px 0; background: #1a1a1b; border-right: 1px solid rgba(255,255,255,0.06); overflow-y: auto; max-height: calc(100vh - 56px); position: sticky; top: 56px; }',
    '.reddit-leftnav .leftnav-section { padding: 0 8px 12px; }',
    '.reddit-leftnav .leftnav-heading { margin: 8px 12px 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(215,218,220,0.45); }',
    '.reddit-leftnav .leftnav-item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 6px; color: #d7dadc; font-size: 13px; font-weight: 500; text-decoration: none; cursor: default; transition: background 160ms ease, color 160ms ease; }',
    '.reddit-leftnav .leftnav-item:hover { background: rgba(255,255,255,0.04); }',
    '.reddit-leftnav .leftnav-item.active { background: rgba(217, 57, 0, 0.16); color: #ffffff; box-shadow: inset 2px 0 0 #d93900; }',
    '.reddit-leftnav .leftnav-icon { width: 20px; text-align: center; font-size: 14px; color: rgba(215,218,220,0.65); }',
    '.reddit-leftnav .leftnav-sub-icon { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #58a6ff, #1677ff); color: #ffffff; font-size: 11px; font-weight: 800; text-align: center; line-height: 22px; flex: 0 0 22px; }',
    '.reddit-leftnav .leftnav-sub.active .leftnav-sub-icon { background: linear-gradient(135deg, #d93900, #ff6a00); box-shadow: 0 0 0 2px rgba(217,57,0,0.25); }',
    '.reddit-leftnav .leftnav-empty { margin: 6px 14px; font-size: 12px; color: rgba(215,218,220,0.4); }',
    '.reddit-leftnav .leftnav-footer { padding: 16px 14px 8px; }',
    '.reddit-leftnav .leftnav-foot-line { margin: 0; font-size: 11px; color: rgba(215,218,220,0.32); font-family: "SF Mono", ui-monospace, monospace; }',

    /* page header（每张卡片顶部的 sub banner / sort tabs / search banner） */
    '.reddit-page-header { display: flex; flex-direction: column; gap: 12px; max-width: 880px; margin: 0 auto 18px; padding: 0; }',
    '.reddit-page-header .page-banner { padding: 14px 18px; background: linear-gradient(135deg, rgba(217,57,0,0.20), rgba(217,57,0,0.04)); border: 1px solid rgba(217,57,0,0.35); border-radius: 10px; }',
    '.reddit-page-header .page-banner .banner-eyebrow { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #ffb097; margin-bottom: 4px; }',
    '.reddit-page-header .page-banner .banner-title { margin: 0 0 4px; font-size: clamp(18px, 2vw, 22px); font-weight: 700; color: #ffffff; word-break: break-word; }',
    '.reddit-page-header .page-banner .banner-meta { margin: 0; font-size: 12px; color: rgba(215,218,220,0.65); }',

    /* sub banner */
    '.reddit-page-header .sub-banner { display: flex; align-items: center; gap: 14px; padding: 14px 18px; background: linear-gradient(135deg, rgba(88,166,255,0.16), rgba(22,119,255,0.04)); border: 1px solid rgba(88,166,255,0.30); border-radius: 10px; }',
    '.reddit-page-header .sub-banner .sub-icon { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #58a6ff, #1677ff); color: #ffffff; font-size: 22px; font-weight: 800; line-height: 44px; text-align: center; flex: 0 0 44px; }',
    '.reddit-page-header .sub-banner .sub-meta { flex: 1; min-width: 0; }',
    '.reddit-page-header .sub-banner .sub-name { margin: 0 0 2px; font-size: 18px; font-weight: 700; color: #ffffff; }',
    '.reddit-page-header .sub-banner .sub-badge { display: inline-block; padding: 2px 8px; font-size: 11px; background: rgba(255,255,255,0.10); color: rgba(215,218,220,0.85); border-radius: 999px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }',
    '.reddit-page-header .banner-cta { padding: 6px 18px; background: #d93900; border: none; border-radius: 999px; color: #ffffff; font-size: 13px; font-weight: 700; cursor: default; }',

    '.reddit-page-header .page-banner-meta { display: flex; gap: 8px; flex-wrap: wrap; padding: 0 4px; }',
    '.reddit-page-header .meta-pill { padding: 4px 10px; font-size: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; color: rgba(215,218,220,0.85); }',
    '.reddit-page-header .meta-pill strong { color: #ffffff; font-weight: 700; }',

    /* sort tabs（横向 pill 一组） */
    '.reddit-page-header .sort-tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 4px 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }',
    '.reddit-page-header .sort-tabs .pill { padding: 4px 14px; font-size: 13px; font-weight: 600; color: rgba(215,218,220,0.7); border-radius: 999px; background: transparent; border: 1px solid transparent; cursor: default; transition: background 160ms ease, color 160ms ease, border-color 160ms ease; }',
    '.reddit-page-header .sort-tabs .pill:hover { background: rgba(255,255,255,0.06); color: #ffffff; }',
    '.reddit-page-header .sort-tabs .pill.active { background: rgba(217,57,0,0.18); color: #ffffff; border-color: rgba(217,57,0,0.45); }',

    /* user dropdown / user banner */
    '.reddit-page-header .user-dropdown, .reddit-page-header .user-banner { display: flex; align-items: center; gap: 14px; padding: 16px 20px; background: linear-gradient(135deg, rgba(217,57,0,0.16), rgba(217,57,0,0.02)); border: 1px solid rgba(217,57,0,0.30); border-radius: 10px; }',
    '.reddit-page-header .user-avatar { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #d93900, #ff6a00); color: #ffffff; font-size: 22px; font-weight: 800; line-height: 44px; text-align: center; flex: 0 0 44px; }',
    '.reddit-page-header .user-avatar.large { width: 56px; height: 56px; line-height: 56px; font-size: 26px; flex: 0 0 56px; }',
    '.reddit-page-header .user-meta, .reddit-page-header .user-dropdown-meta { flex: 1; min-width: 0; }',
    '.reddit-page-header .user-name { margin: 0 0 2px; font-size: 18px; font-weight: 700; color: #ffffff; }',
    '.reddit-page-header .user-sub, .reddit-page-header .user-karma { margin: 0; font-size: 12px; color: rgba(215,218,220,0.55); }',
    '.reddit-page-header .user-status { display: flex; align-items: center; gap: 6px; margin: 0 0 2px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #b6f0a3; }',
    '.reddit-page-header .user-status .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #52c41a; box-shadow: 0 0 0 3px rgba(82,196,26,0.20); }',

    /* nav breadcrumb */
    '.reddit-page-header .nav-breadcrumb { display: flex; align-items: center; gap: 10px; padding: 14px 18px; background: rgba(88,166,255,0.06); border: 1px solid rgba(88,166,255,0.18); border-radius: 10px; flex-wrap: wrap; }',
    '.reddit-page-header .nav-tag { padding: 2px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; background: rgba(88,166,255,0.20); color: #91c4ff; border-radius: 999px; }',
    '.reddit-page-header .nav-from, .reddit-page-header .nav-to { font-family: "SF Mono", ui-monospace, monospace; font-size: 12px; color: rgba(215,218,220,0.85); padding: 3px 8px; background: rgba(255,255,255,0.04); border-radius: 4px; word-break: break-all; }',
    '.reddit-page-header .nav-to { color: #58a6ff; }',
    '.reddit-page-header .nav-arrow { color: #58a6ff; font-size: 16px; }',

    /* card-stage 切卡过渡：reddit 模式下卡片 max-width 收一些适应 shell */
    'body[data-shell="reddit"] .card-stage { max-width: 880px; margin: 0 auto; padding-bottom: 20px; }',
    'body[data-shell="reddit"] .reddit-stage { max-width: 880px; }',

    /* 响应式：< 900px 隐藏 leftnav */
    '@media (max-width: 900px) { body[data-shell="reddit"] #reddit-shell { grid-template-columns: minmax(0, 1fr); grid-template-areas: "topbar" "content"; } body[data-shell="reddit"] .reddit-leftnav { display: none; } body[data-shell="reddit"] .reddit-topbar .brand { min-width: auto; } body[data-shell="reddit"] .reddit-topbar .topbar-create .create-label { display: none; } }',
    '@media (max-width: 600px) { body[data-shell="reddit"] .reddit-topbar .topbar-avatar .avatar-name { display: none; } body[data-shell="reddit"] .reddit-page-header .sub-banner .sub-icon { width: 36px; height: 36px; line-height: 36px; flex: 0 0 36px; font-size: 18px; } }',

    /* v0.4.0 DOM-first：cursor / click ripple / spinner / typing caret */
    '.jse-cursor { position: fixed; left: -100px; top: -100px; width: 22px; height: 22px; pointer-events: none; z-index: 1100; transform: translate(-2px, -2px); background-image: url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 3l14 8-7 1-3 8-4-17z" fill="%23ffffff" stroke="%23000000" stroke-width="1" stroke-linejoin="round"/></svg>\'); background-repeat: no-repeat; background-size: contain; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.55)); transition: opacity 200ms ease; }',
    '.jse-click-ripple { position: fixed; width: 22px; height: 22px; margin-left: -11px; margin-top: -11px; border-radius: 50%; border: 2px solid #d93900; box-shadow: 0 0 8px rgba(217,57,0,0.55); animation: jse-ripple 640ms ease-out forwards; pointer-events: none; z-index: 1099; }',
    '@keyframes jse-ripple { 0% { transform: scale(0.4); opacity: 1; } 100% { transform: scale(2.6); opacity: 0; } }',
    '.jse-spinner { position: fixed; width: 28px; height: 28px; margin-left: -14px; margin-top: -14px; border: 3px solid rgba(217,57,0,0.22); border-top-color: #d93900; border-radius: 50%; animation: jse-spin 800ms linear infinite; pointer-events: none; z-index: 1098; }',
    '@keyframes jse-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }',
    '.jse-typing-caret { display: inline-block; width: 1px; height: 1em; vertical-align: -2px; margin-left: 1px; background: currentColor; animation: jse-blink 1s step-end infinite; }',
    '@keyframes jse-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }',
    /* shell search input 在 typing 时显 caret 视觉（不依赖 input native caret） */
    'body[data-shell="reddit"] [data-shell-search]:focus { outline: none; }',

    /* ===========================================================
       v0.5.0 snapshot mode：#stage[data-mode="snapshot"] PNG 序列舞台。
       双缓冲层 .jse-frame-img-cur / .jse-frame-img-next cross-fade 220ms。
       reddit shell 在 body[data-frames="present"] 时隐藏 chrome（dom 段全 PNG），
       fallback 段（无 frame）仍保留 shell + 卡片。
       =========================================================== */
    '#stage[data-mode="snapshot"] { padding: 0; min-height: 100vh; background: #0e1116; display: flex; align-items: stretch; justify-content: center; overflow: hidden; }',
    '#stage[data-mode="snapshot"]::before { display: none; }',
    '#stage[data-mode="snapshot"] .jse-frame-img-cur, #stage[data-mode="snapshot"] .jse-frame-img-next { position: absolute; inset: 0; background-color: #0e1116; background-size: contain; background-position: top center; background-repeat: no-repeat; transition: opacity 220ms ease; will-change: opacity, background-image; }',
    '#stage[data-mode="snapshot"] .jse-frame-img-cur { opacity: 1; z-index: 1; }',
    '#stage[data-mode="snapshot"] .jse-frame-img-next { opacity: 0; z-index: 2; }',
    /* snapshot stage 容纳真实 reddit 截图，整张图当背景；卡片层 / shell chrome 默认隐藏 */
    '#stage[data-mode="snapshot"] > .reddit-stage, #stage[data-mode="snapshot"] > .reddit-info-card, #stage[data-mode="snapshot"] > .reddit-comment-tree, #stage[data-mode="snapshot"] > .card-stage { display: none; }',
    /* dom 段：frames 存在时把 reddit shell 的 topbar / leftnav 隐掉，舞台占满整屏 */
    'body[data-shell="reddit"][data-frames="present"] #reddit-shell { grid-template-rows: 1fr; grid-template-columns: minmax(0, 1fr); grid-template-areas: "content"; }',
    'body[data-shell="reddit"][data-frames="present"] .reddit-topbar, body[data-shell="reddit"][data-frames="present"] .reddit-leftnav { display: none; }',
    'body[data-shell="reddit"][data-frames="present"] #stage { grid-area: content; min-height: 100vh; padding: 0; border-left: none; }',
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
