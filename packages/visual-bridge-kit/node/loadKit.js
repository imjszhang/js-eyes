'use strict';

// @js-eyes/visual-bridge-kit · node/loadKit.js
// ---------------------------------------------------------------------------
// 给 one-shot inject 模型（browser-ops、x-ops 等无长驻 bridge 的 skill）准备
// 一段拼接好的字符串：
//   bridge/visual.common.js  (始终包含)
// + ;
// + 站点专属 anchor resolver  (可选)
//
// 模块级 cache，按 siteAnchorPath 区分 key。
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const BRIDGE_VISUAL_PATH = path.join(__dirname, '..', 'bridge', 'visual.common.js');

const cache = new Map();

/**
 * loadVisualKitSource - 返回一段可以直接 inject 到 page world 的字符串。
 *
 * @param {object} [opts]
 * @param {string} [opts.siteAnchorPath] - 站点专属 _visual-<site>.js 绝对路径；
 *                                         省略则只返回 visual.common.js 的内容。
 * @returns {string}
 */
function loadVisualKitSource(opts){
  const o = opts || {};
  const key = o.siteAnchorPath || '';
  if (cache.has(key)) return cache.get(key);

  let src;
  try { src = fs.readFileSync(BRIDGE_VISUAL_PATH, 'utf8'); }
  catch (err) {
    throw new Error('loadVisualKitSource: 读取 visual.common.js 失败 · ' + err.message);
  }

  if (key) {
    let siteSrc;
    try { siteSrc = fs.readFileSync(key, 'utf8'); }
    catch (err) {
      throw new Error('loadVisualKitSource: 读取站点 anchor resolver 失败: ' + key + ' · ' + err.message);
    }
    src = src + '\n;' + siteSrc;
  }

  cache.set(key, src);
  return src;
}

module.exports = {
  loadVisualKitSource,
  BRIDGE_VISUAL_PATH,
};
