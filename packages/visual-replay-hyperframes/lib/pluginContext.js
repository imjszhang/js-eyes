'use strict';

// pluginContext.js
// ---------------------------------------------------------------------------
// 给 plugin 的只读上下文对象工厂。translator 把已经准备好的数据（session /
// timeline / composition meta）打包成一个 ctx，传给每个 plugin 的 hook。
// 设计原则：
//   - 完全只读：plugin 不该 mutate ctx；翻译层做了 freeze 保险，hook 必须用
//     return value 影响 composition（注入 head/body/timeline 字符串等）
//   - 数据形态贴近现有 timeline 结构：hud / flash / relation / frames / dom
//     直接透传，避免 plugin 作者重新解析
//   - logger 走 stderr，避免污染 jse-replay stdout 的 JSON 输出
// ---------------------------------------------------------------------------

const PLUGIN_LOG_PREFIX = '[jse-plugin]';

/**
 * 创建一个只读的 plugin context。
 *
 * @param {object} input
 * @param {object} input.session         - readVisualSession 返回值（含 meta、entries）
 * @param {object} input.timeline        - buildTimeline.clips + 派生字段
 * @param {object} input.composition     - { id, durationSec, viewport, outDir }
 * @param {object} input.config          - --plugin-config 解析得到的 plugin 私有配置
 * @returns {object} 冻结后的 ctx
 */
function createPluginContext(input){
  const ctx = {
    session: freezeShallow({
      meta: input.session && input.session.meta ? input.session.meta : null,
      entries: Array.isArray(input.session && input.session.entries) ? input.session.entries : [],
    }),
    timeline: freezeShallow({
      hud: arr(input.timeline && input.timeline.hud),
      flash: arr(input.timeline && input.timeline.flash),
      relation: arr(input.timeline && input.timeline.relation),
      frames: arr(input.timeline && input.timeline.frames),
      before: arr(input.timeline && input.timeline.before),
      after: arr(input.timeline && input.timeline.after),
      dom: input.timeline && input.timeline.dom ? input.timeline.dom : emptyDom(),
      durationSec: Number(input.timeline && input.timeline.durationSec) || 0,
    }),
    composition: freezeShallow({
      id: String(input.composition && input.composition.id || ''),
      durationSec: Number(input.composition && input.composition.durationSec) || 0,
      viewport: input.composition && input.composition.viewport ? input.composition.viewport : null,
      outDir: String(input.composition && input.composition.outDir || ''),
      snapshotMode: String(input.composition && input.composition.snapshotMode || 'template'),
    }),
    config: input.config && typeof input.config === 'object' ? Object.freeze(Object.assign({}, input.config)) : Object.freeze({}),
    logger: makeLogger(input.composition && input.composition.id),
  };
  return Object.freeze(ctx);
}

function arr(v){ return Array.isArray(v) ? v : []; }

function emptyDom(){
  return Object.freeze({
    navigate: [], locate: [], hover: [], click: [], typing: [], scroll: [], wait: [], extract: [],
  });
}

function freezeShallow(o){
  // 只 freeze 顶层；array 内部对象不再深 freeze（性能 + plugin 真要 mutate 自己的副本）
  return Object.freeze(o);
}

function makeLogger(compositionId){
  const tag = compositionId ? PLUGIN_LOG_PREFIX + ' [' + compositionId + ']' : PLUGIN_LOG_PREFIX;
  return Object.freeze({
    info(msg){ try { process.stderr.write(tag + ' ' + msg + '\n'); } catch (_) {} },
    warn(msg){ try { process.stderr.write(tag + ' WARN: ' + msg + '\n'); } catch (_) {} },
  });
}

module.exports = { createPluginContext };
