'use strict';

// sample-local-plugin.js
// ---------------------------------------------------------------------------
// 验收用：最小可工作的 local plugin（贴一个固定水印 + 一行字幕）。
// 任何作者照抄这个文件即可写出自己的 plugin：
//   1. 起个 name（建议 npm-style 命名，避免和其他 plugin 撞 class）
//   2. 实现感兴趣的 hook（5 个里挑用得到的）
//   3. 用 --plugin=./your-plugin.js 接进去
//
// 用法：
//   jse-replay <session> \
//     --plugin=./packages/visual-replay-hyperframes/__fixtures__/sample-local-plugin.js \
//     --plugin-config 'sample-local-plugin={"caption":"Hi from a local plugin"}' \
//     --no-render --keep
// ---------------------------------------------------------------------------

const NAME = 'sample-local-plugin';
const VERSION = '0.0.1';

module.exports = {
  name: NAME,
  version: VERSION,

  injectHead(){
    return [
      '<style data-jse-plugin="' + NAME + '">',
      '#sample-local-plugin-watermark {',
      '  position: fixed; right: 24px; bottom: 56px;',
      '  padding: 6px 12px;',
      '  background: rgba(22, 119, 255, 0.85);',
      '  color: #fff; font: 600 12px/1.2 -apple-system, system-ui, sans-serif;',
      '  border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);',
      '  z-index: 1100; pointer-events: none;',
      '}',
      '#sample-local-plugin-caption {',
      '  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);',
      '  padding: 8px 16px;',
      '  background: rgba(0,0,0,0.7); color: #fff;',
      '  font: 600 14px/1.3 -apple-system, system-ui, sans-serif;',
      '  border-radius: 8px;',
      '  z-index: 1100; pointer-events: none;',
      '}',
      '</style>',
    ].join('\n');
  },

  injectBody(ctx){
    const caption = (ctx.config && typeof ctx.config.caption === 'string')
      ? ctx.config.caption
      : 'sample-local-plugin · v' + VERSION;
    const watermark = (ctx.config && typeof ctx.config.watermark === 'string')
      ? ctx.config.watermark
      : 'LOCAL PLUGIN';
    return [
      '<div id="sample-local-plugin-watermark">' + escapeHtml(watermark) + '</div>',
      '<div id="sample-local-plugin-caption">' + escapeHtml(caption) + '</div>',
    ].join('\n');
  },

  contributeSummary(ctx){
    return {
      version: VERSION,
      hookedCaption: !!(ctx.config && ctx.config.caption),
    };
  },
};

function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
