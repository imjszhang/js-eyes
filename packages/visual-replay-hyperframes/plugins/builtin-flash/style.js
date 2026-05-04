'use strict';

// @builtin/flash · CSS
// ---------------------------------------------------------------------------
// flash 描边动画：从 v0.6.x 内置 styleEmbed 中的 .flash-active + 4 条 keyframes
// 原样搬过来。模板里每张卡片的 data-anchor-id="..." 会在 flash 时刻被 add
// .flash-active，CSS 跑 600ms outline + glow 动画后由 timeline 移除。
// ---------------------------------------------------------------------------

function getFlashCss(){
  return [
    /* keyframes：基础蓝 / success 绿 / error 红 / pending 黄 */
    '@keyframes jse-flash-pulse { 0% { outline-width: 2px; outline-color: rgba(22,119,255,0); box-shadow: 0 0 0 0 rgba(22,119,255,0); } 35% { outline-width: 4px; outline-color: rgba(22,119,255,0.85); box-shadow: 0 0 0 6px rgba(22,119,255,0.18); } 100% { outline-width: 2px; outline-color: rgba(22,119,255,0); box-shadow: 0 0 0 0 rgba(22,119,255,0); } }',
    '@keyframes jse-flash-pulse-success { 0% { outline-color: rgba(82,196,26,0); box-shadow: 0 0 0 0 rgba(82,196,26,0); } 35% { outline-color: rgba(82,196,26,0.9); box-shadow: 0 0 0 6px rgba(82,196,26,0.2); } 100% { outline-color: rgba(82,196,26,0); box-shadow: 0 0 0 0 rgba(82,196,26,0); } }',
    '@keyframes jse-flash-pulse-error { 0% { outline-color: rgba(255,77,79,0); box-shadow: 0 0 0 0 rgba(255,77,79,0); } 35% { outline-color: rgba(255,77,79,0.9); box-shadow: 0 0 0 6px rgba(255,77,79,0.22); } 100% { outline-color: rgba(255,77,79,0); box-shadow: 0 0 0 0 rgba(255,77,79,0); } }',
    '@keyframes jse-flash-pulse-pending { 0% { outline-color: rgba(250,173,20,0); box-shadow: 0 0 0 0 rgba(250,173,20,0); } 35% { outline-color: rgba(250,173,20,0.9); box-shadow: 0 0 0 6px rgba(250,173,20,0.22); } 100% { outline-color: rgba(250,173,20,0); box-shadow: 0 0 0 0 rgba(250,173,20,0); } }',
    /* class（toggle 用） */
    '.flash-active { animation: jse-flash-pulse 600ms ease-out; outline: 2px solid rgba(22,119,255,0.85); outline-offset: 2px; }',
    '.flash-active[data-tone="success"], .flash-active.tone-success { animation: jse-flash-pulse-success 600ms ease-out; outline-color: rgba(82,196,26,0.85); }',
    '.flash-active[data-tone="error"], .flash-active.tone-error, .flash-active[data-tone="danger"], .flash-active.tone-danger { animation: jse-flash-pulse-error 600ms ease-out; outline-color: rgba(255,77,79,0.85); }',
    '.flash-active[data-tone="pending"], .flash-active.tone-pending, .flash-active[data-tone="warn"], .flash-active.tone-warn { animation: jse-flash-pulse-pending 600ms ease-out; outline-color: rgba(250,173,20,0.85); }',
  ].join('\n');
}

module.exports = { getFlashCss };
