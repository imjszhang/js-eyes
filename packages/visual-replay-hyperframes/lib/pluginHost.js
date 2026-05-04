'use strict';

// pluginHost.js
// ---------------------------------------------------------------------------
// jse-replay 的 plugin 系统核心。负责：
//   1. 把 CLI 给的 plugin id 列表（@builtin/* | @js-eyes/* | ./local.js | 绝对路径）
//      解析成实际的 plugin 对象
//   2. 跑 5 个 hook 把它们的输出聚合成 head/body/timeline/assets/summary
//   3. fail-fast：plugin require 失败 / hook throw 都直接冒泡到 translate()，
//      composition 一旦成形不可修复，错就错在生成时
//
// plugin 接口：
//   {
//     name: string,        // unique
//     version: string,
//     injectHead?(ctx): string,
//     injectBody?(ctx): string,
//     injectTimeline?(ctx): string,
//     collectAssets?(ctx): Array<{ from: string, to: string }>,
//     contributeSummary?(ctx): object,
//   }
//
// id 解析规则（v0.7.0）：
//   - '@builtin/hud'           → require('<pkg>/plugins/builtin-hud')
//   - '@builtin/flash'         → require('<pkg>/plugins/builtin-flash')
//   - '@js-eyes/spotlight'     → require('<pkg>/plugins/community/spotlight')
//   - './foo.js' / 'foo.js'    → require(path.resolve(cwd, id))
//   - 绝对路径                 → require(id)
//   - 其他（npm 包名）         → 暂不支持，throw
// ---------------------------------------------------------------------------

const path = require('path');

// builtin / community plugin 路径表（相对 lib/）
const BUILTIN_REGISTRY = {
  '@builtin/hud': '../plugins/builtin-hud',
  '@builtin/flash': '../plugins/builtin-flash',
  '@js-eyes/spotlight': '../plugins/community/spotlight',
};

const HOOK_NAMES = ['injectHead', 'injectBody', 'injectTimeline', 'collectAssets', 'contributeSummary'];

/**
 * 把 plugin id 解析成 plugin 对象（require + sanity check）。
 *
 * @param {string} id
 * @param {string} [cwd]  - 解析相对路径时的基准目录（默认 process.cwd()）
 * @returns {object} plugin
 */
function resolvePlugin(id, cwd){
  if (!id || typeof id !== 'string') {
    throw new Error('plugin id 必须是非空字符串，got ' + JSON.stringify(id));
  }
  const trimmed = id.trim();
  let modulePath;

  if (Object.prototype.hasOwnProperty.call(BUILTIN_REGISTRY, trimmed)) {
    modulePath = require.resolve(BUILTIN_REGISTRY[trimmed]);
  } else if (path.isAbsolute(trimmed)) {
    modulePath = trimmed;
  } else if (trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.endsWith('.js')) {
    modulePath = path.resolve(cwd || process.cwd(), trimmed);
  } else {
    throw new Error('plugin id 暂不支持: ' + trimmed
      + '（v0.7.0 仅支持 @builtin/*、@js-eyes/* 与本地路径；npm 包计划 v0.7.1）');
  }

  let mod;
  try {
    mod = require(modulePath);
  } catch (err) {
    throw new Error('plugin 加载失败 ' + trimmed + ' → ' + modulePath + ': ' + err.message);
  }

  // 同时支持 module.exports = plugin / module.exports = { default: plugin } / function() => plugin
  let plugin = mod;
  if (typeof plugin === 'function') plugin = plugin();
  if (plugin && plugin.default && typeof plugin.default === 'object') plugin = plugin.default;

  if (!plugin || typeof plugin !== 'object') {
    throw new Error('plugin ' + trimmed + ' 模块没有导出 plugin 对象');
  }
  if (!plugin.name || typeof plugin.name !== 'string') {
    throw new Error('plugin ' + trimmed + ' 缺少 name 字段');
  }

  // sanity check：所有 hook 必须是 function（如果存在）
  for (const h of HOOK_NAMES) {
    if (plugin[h] !== undefined && typeof plugin[h] !== 'function') {
      throw new Error('plugin ' + plugin.name + '.' + h + ' 必须是 function');
    }
  }

  return plugin;
}

/**
 * 解析一组 plugin id（按出现顺序），保留原顺序。同名 plugin 会被去重（保留首次出现），
 * 但不同 id 解析到同 name 也会冲突 → throw。
 *
 * @param {Array<string>} ids
 * @param {string} [cwd]
 * @returns {Array<object>} plugins
 */
function resolveList(ids, cwd){
  const list = [];
  const seen = new Set();
  for (const id of (Array.isArray(ids) ? ids : [])) {
    const plugin = resolvePlugin(id, cwd);
    if (seen.has(plugin.name)) {
      // 同 name 重复 → silent skip（CLI 出现 --plugin=@builtin/hud --plugin=@builtin/hud 也不报错）
      continue;
    }
    seen.add(plugin.name);
    list.push({ id: id, plugin });
  }
  return list;
}

/**
 * 跑一组 plugin 的所有 hook，按 plugin 出现顺序拼接字符串型输出，merge object 型。
 * fail-fast：任意 hook throw 直接冒泡。
 *
 * @param {Array<{id, plugin, config}>} entries
 * @param {object} ctxFactory  - 接受 (plugin, config) 返回 ctx 的工厂（每个 plugin 单独 build）
 * @returns {{ head: string, body: string, timeline: string, assets: Array, summary: object }}
 */
function runHooks(entries, ctxFactory){
  const out = { head: [], body: [], timeline: [], assets: [], summary: {} };

  for (const entry of entries) {
    const { id, plugin, config } = entry;
    const ctx = ctxFactory(plugin, config || {});

    // injectHead → 字符串（CSS/meta），按出现顺序拼接
    if (typeof plugin.injectHead === 'function') {
      const r = plugin.injectHead(ctx);
      if (typeof r === 'string' && r) out.head.push(commentMark(plugin.name, 'head') + r);
    }
    if (typeof plugin.injectBody === 'function') {
      const r = plugin.injectBody(ctx);
      if (typeof r === 'string' && r) out.body.push(commentMark(plugin.name, 'body') + '\n' + r);
    }
    if (typeof plugin.injectTimeline === 'function') {
      const r = plugin.injectTimeline(ctx);
      if (typeof r === 'string' && r) out.timeline.push(jsCommentMark(plugin.name, 'timeline') + '\n' + r);
    }
    if (typeof plugin.collectAssets === 'function') {
      const r = plugin.collectAssets(ctx);
      if (Array.isArray(r)) {
        for (const a of r) {
          if (a && typeof a.from === 'string' && typeof a.to === 'string') out.assets.push(a);
        }
      }
    }
    if (typeof plugin.contributeSummary === 'function') {
      const r = plugin.contributeSummary(ctx);
      if (r && typeof r === 'object' && !Array.isArray(r)) out.summary[plugin.name] = r;
    }
    // 留个痕迹：哪怕 plugin 啥都没注入，summary 至少标一下版本
    if (!out.summary[plugin.name]) out.summary[plugin.name] = { version: plugin.version || 'unknown' };
    // id 跟 name 可能不一样（local plugin id 是路径），存一份方便审计
    if (!out.summary[plugin.name]._id) out.summary[plugin.name]._id = id;
  }

  return {
    head: out.head.join('\n'),
    body: out.body.join('\n'),
    timeline: out.timeline.join('\n'),
    assets: out.assets,
    summary: out.summary,
  };
}

function commentMark(name, slot){ return '<!-- plugin:' + name + ' ' + slot + ' -->\n'; }
function jsCommentMark(name, slot){ return '/* plugin:' + name + ' ' + slot + ' */'; }

module.exports = {
  resolvePlugin,
  resolveList,
  runHooks,
  BUILTIN_REGISTRY,
  HOOK_NAMES,
};
