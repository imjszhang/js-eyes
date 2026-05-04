'use strict';

// @js-eyes/spotlight · CSS
// ---------------------------------------------------------------------------
// 全屏 fixed overlay：黑色 mask + 中心 transparent ring。配合 timelineScript 端
// setSpotlight(rect) 动态更新 CSS variables 实现"聚光灯跟随 dom_locate.rect"。
// 默认参数都用 CSS variable，plugin 端 inject 时可以从 ctx.config 覆盖：
//   --spotlight-radius / --spotlight-dim-alpha / --spotlight-tone (color)
// ---------------------------------------------------------------------------

function getSpotlightCss(){
  return [
    /* 顶层 overlay：默认 hidden（display:none），在 dom_locate 时被脚本切到 block */
    '#jse-spotlight-overlay {',
    '  position: fixed; inset: 0; pointer-events: none; z-index: 900;',
    '  display: none;',
    '  --spotlight-x: 50%;',
    '  --spotlight-y: 50%;',
    '  --spotlight-radius: 100px;',
    '  --spotlight-dim-alpha: 0.55;',
    '  --spotlight-tone: rgba(255,180,76,0.9); /* warm orange ring */',
    '}',
    /* 黑色蒙版：用 radial-gradient 在 (x,y) 处挖透明圆 */
    '#jse-spotlight-overlay::before {',
    '  content: "";',
    '  position: absolute; inset: 0;',
    '  background: radial-gradient(',
    '    circle at var(--spotlight-x) var(--spotlight-y),',
    '    rgba(0,0,0,0) 0,',
    '    rgba(0,0,0,0) calc(var(--spotlight-radius) - 4px),',
    '    rgba(0,0,0,var(--spotlight-dim-alpha)) calc(var(--spotlight-radius) + 8px),',
    '    rgba(0,0,0,var(--spotlight-dim-alpha)) 100%',
    '  );',
    '  transition: background 220ms ease;',
    '}',
    /* 圆环：用第二层 ::after 描边，色调可换 */
    '#jse-spotlight-overlay::after {',
    '  content: "";',
    '  position: absolute;',
    '  left: var(--spotlight-x); top: var(--spotlight-y);',
    '  width: calc(var(--spotlight-radius) * 2);',
    '  height: calc(var(--spotlight-radius) * 2);',
    '  margin-left: calc(var(--spotlight-radius) * -1);',
    '  margin-top: calc(var(--spotlight-radius) * -1);',
    '  border-radius: 50%;',
    '  border: 3px solid var(--spotlight-tone);',
    '  box-shadow: 0 0 32px var(--spotlight-tone);',
    '  transition: left 220ms ease, top 220ms ease, width 220ms ease, height 220ms ease;',
    '  opacity: 0.9;',
    '}',
    '#jse-spotlight-overlay[data-active="false"]::after { opacity: 0; }',
  ].join('\n');
}

module.exports = { getSpotlightCss };
