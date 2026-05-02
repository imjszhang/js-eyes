'use strict';

// @js-eyes/visual-bridge-kit · node/bridgeIncludes.js
// ---------------------------------------------------------------------------
// 通用 `// @@include <path>` 预处理器，给 bridge 文件做单层展开。
//
// 特性：
//   - 相对路径：`// @@include ./common.js`
//        → 相对 baseDir 解析（baseDir 默认是 bridge 文件所在目录）
//   - 包路径：`// @@include @js-eyes/visual-bridge-kit/bridge/visual.common.js`
//        → 走 require.resolve（从 baseDir 起始，沿 node_modules 上溯）
//   - 多层递归：被 include 的文件里可以继续写 `@@include`，会被继续展开。
//        通过 visited 集合在同一文件链上去重，避免循环；safety counter 兜底。
//
// 行格式（必须独占一行）：
//        ^[ \t]*//[ \t]*@@include[ \t]+<path>[ \t]*$
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const INCLUDE_LINE = /^[ \t]*\/\/[ \t]*@@include[ \t]+(\S+)[ \t]*$/m;

function isPackagePath(p){
  if (!p) return false;
  if (p.startsWith('.') || p.startsWith('/')) return false;
  return true;
}

function resolveIncludeTarget(spec, baseDir){
  if (!spec) return null;
  if (spec.startsWith('.') || spec.startsWith('/')) {
    return path.resolve(baseDir, spec);
  }
  if (isPackagePath(spec)) {
    try {
      return require.resolve(spec, { paths: [baseDir] });
    } catch (err) {
      const e = new Error('@@include 包路径解析失败: ' + spec + ' (from ' + baseDir + ') · ' + err.message);
      e.code = 'E_INCLUDE_RESOLVE';
      throw e;
    }
  }
  return null;
}

/**
 * makeBridgeExpander - 工厂：返回一个 expandBridgeSource(src, opts?) 函数。
 *
 * @param {Object} options
 * @param {string} options.baseDir - 默认相对路径基准（一般是 bridges/ 目录）
 * @returns {(src: string, opts?: { baseDir?: string }) => string}
 */
function makeBridgeExpander(options){
  const opts = options || {};
  const defaultBaseDir = opts.baseDir;
  if (!defaultBaseDir) {
    throw new Error('makeBridgeExpander: baseDir is required');
  }
  return function expandBridgeSource(src, callOpts){
    if (typeof src !== 'string') return src;
    const baseDir = (callOpts && callOpts.baseDir) || defaultBaseDir;
    const visited = new Set();
    let out = src;
    let safety = 0;
    while (INCLUDE_LINE.test(out)) {
      out = out.replace(INCLUDE_LINE, (line, spec) => {
        const target = resolveIncludeTarget(spec, baseDir);
        if (!target) {
          throw Object.assign(new Error('@@include 无效路径: ' + spec), { code: 'E_INCLUDE_BAD_PATH' });
        }
        if (visited.has(target)) {
          // 已经展开过同一文件 → 注释掉，幂等不重复
          return '// (already-included) ' + spec;
        }
        visited.add(target);
        let body;
        try {
          body = fs.readFileSync(target, 'utf8');
        } catch (err) {
          const e = new Error('@@include 读取失败: ' + target + ' · ' + err.message);
          e.code = 'E_INCLUDE_READ';
          throw e;
        }
        return body;
      });
      safety++;
      if (safety > 64) {
        throw Object.assign(new Error('@@include 展开次数超限，疑似循环依赖'), { code: 'E_INCLUDE_OVERFLOW' });
      }
    }
    return out;
  };
}

module.exports = {
  makeBridgeExpander,
  resolveIncludeTarget,
};
