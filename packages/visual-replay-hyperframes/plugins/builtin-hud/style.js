'use strict';

// @builtin/hud · CSS
// ---------------------------------------------------------------------------
// 把原 lib/styleEmbed.js 的 .jse-hud 系列规则原样搬过来，0 回归。
// CSS 命名空间 jse-hud-* / .jse-hud：plugin 约定共享老 class 名（v0.6.x 之前
// 内置在 styleEmbed），这样老 events.jsonl 重渲行为完全一致。
// ---------------------------------------------------------------------------

function getHudCss(){
  return [
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
    /* 小屏适配（沿用老规则） */
    '@media (max-width: 700px) { .jse-hud { right: 12px; top: 12px; left: 12px; max-width: none; } }',
  ].join('\n');
}

module.exports = { getHudCss };
