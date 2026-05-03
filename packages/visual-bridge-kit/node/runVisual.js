'use strict';

// @js-eyes/visual-bridge-kit · node/runVisual.js
// ---------------------------------------------------------------------------
// before/after hook，包在 session.callApi 两端。
//
// 用法（单文件 trace 形态）：
//   const summary = await wrapCallApi(session, hint, async () => {
//     return await session.callApi(method, [args]);
//   });
//   const events = await drainVisualEvents(session);
//   appendVisualTrace(tracePath, { runId, toolName, args, hint, summary, events });
//
// 用法（会话包目录形态，给离线 hyperframes 重渲染用）：
//   appendVisualSession(recordDir, { runId, toolName, args, hint, ok, durationMs, events },
//                       { skillId, skillVersion });
//
// post-2.7.0 architecture pivot：
//   - PNG 截图（captureFrame）已从主链路下线，captureFrame.js 与 hooks.captureFrame
//     仍可用但仅作 dev / debug 入口，wrapCallApi/wrapInjectCall 不再主动调用。
//   - 主链路新增 hooks.extractPayload(resp, hint, err) => payload 钩子：
//       payload 由 skill 端按 hint.kind 抽取业务数据（list 类返回 items + meta，
//       item 类返回单条字段，tree 类返回 items + relations 等），由 wrapCallApi 写入
//       after event 的 payload 字段，下游 hyperframes translator 按 hint.kind 路由
//       到对应的 HTML 模板，渲染响应式卡片。
//   - 配套：events 不再带 anchor.rect / viewport / frameRef；flash 通过 anchor 的
//     id 与 HTML data-anchor-id 绑定，实现"卡片自适应 + flash 跟随"的零错位。
//
// hint shape:
//   {
//     kind: 'item' | 'list' | 'tree' | 'global' | 'navigation' | 'write',
//     toolName: string,
//     label: string,
//     anchor: string | object | null,    // fullname / selector / spec
//     target: string,
//     detail: string,
//     tone: 'info' | 'pending' | 'success' | 'danger',
//   }
//
// summary（after）shape:
//   {
//     ok: boolean,
//     items: Array<anchorSpec>,    // list 类型
//     relate: Array<{from,to,label}>,  // tree 类型
//     errorCode: string,
//     detail: string,
//   }
// ---------------------------------------------------------------------------

const SAFE = (x) => {
  try { return JSON.stringify(x); } catch (_) { return 'null'; }
};

function buildBeforeExpression(hint){
  const h = hint || {};
  const safe = {
    kind: h.kind || 'global',
    toolName: h.toolName || '',
    label: h.label || h.toolName || '',
    anchor: h.anchor || null,
    target: h.target || '',
    detail: h.detail || '',
    tone: h.tone || 'pending',
  };
  return '(window.__jse_visual && window.__jse_visual.before(' + SAFE(safe) + ')) || null';
}

function buildAfterExpression(hint, summary){
  const h = hint || {};
  const s = summary || {};
  const safeHint = {
    kind: h.kind || 'global',
    toolName: h.toolName || '',
    label: h.label || h.toolName || '',
    anchor: h.anchor || null,
    target: h.target || '',
    detail: h.detail || '',
    tone: h.tone || 'pending',
  };
  const safeSummary = {
    ok: s.ok !== false,
    items: Array.isArray(s.items) ? s.items.slice(0, 12) : [],
    relate: Array.isArray(s.relate) ? s.relate.slice(0, 64) : [],
    errorCode: s.errorCode || '',
    detail: s.detail || '',
    target: s.target || '',
    // post-2.7.0：业务数据 payload，由 hooks.extractPayload 提取
    payload: (s && typeof s.payload === 'object' && s.payload !== null) ? s.payload : null,
  };
  return '(window.__jse_visual && window.__jse_visual.after(' + SAFE(safeHint) + ',' + SAFE(safeSummary) + ')) || null';
}

function buildDrainExpression(){
  return '(window.__jse_visual && window.__jse_visual.drainEvents()) || []';
}

function buildConfigExpression(visualConfig){
  return '(window.__jse_visual && window.__jse_visual.config(' + SAFE(visualConfig || {}) + ')) || null';
}

async function callRawSafely(session, expression){
  if (!session || typeof session.callRaw !== 'function') return null;
  try {
    return await session.callRaw(expression, { timeoutMs: 5000 });
  } catch (_) {
    return null;
  }
}

// ----- Phase 2: captureFrame fire-and-forget helpers ------------------------
function buildFrameRef(ts){
  return 'frames/' + ts + '.png';
}

function safeCaptureFrame(captureFrame, info){
  if (typeof captureFrame !== 'function') return null;
  let ret;
  try {
    ret = captureFrame(info);
  } catch (_) { return info; }
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {}, () => {});
  }
  return info;
}

function attachFrameRefsToEvents(events, frames){
  if (!Array.isArray(events) || !Array.isArray(frames) || frames.length === 0) return events;
  for (const f of frames) {
    if (!f || !f.ts || !f.when || !f.frameRef) continue;
    let candidate = null;
    let bestDelta = Infinity;
    for (const e of events) {
      if (!e || e.type !== f.when) continue;
      const eTs = Number(e.ts);
      if (!Number.isFinite(eTs)) continue;
      const delta = Math.abs(eTs - f.ts);
      if (delta < bestDelta) {
        bestDelta = delta;
        candidate = e;
      }
    }
    if (candidate && bestDelta <= 1500 && !candidate.frameRef) {
      candidate.frameRef = f.frameRef;
    }
  }
  return events;
}

/**
 * applyVisualConfig - 在 ensureBridge 之后下发一次 config。幂等。
 */
async function applyVisualConfig(session, visualConfig){
  if (!session || !visualConfig) return null;
  return callRawSafely(session, buildConfigExpression(visualConfig));
}

/**
 * wrapCallApi - 在 fn() 前后调 before/after。fn 必须返回 callApi 的 resp。
 *
 * @param {object} session - reddit-ops Session (必须有 callRaw)
 * @param {object} hint - visualHint
 * @param {(opts?: object) => Promise<any>} fn - 真正的 callApi 调用，接收 derivedHint
 * @param {object} [hooks]
 * @param {(resp, hint, err) => object} [hooks.buildSummary] - 默认 defaultBuildSummary
 * @param {(resp, hint, err) => object|null} [hooks.extractPayload] - **post-2.7.0 主链路**：
 *     抽业务数据塞到 after event 的 payload 字段，给 HTML translator 重渲卡片用
 * @param {Function} [hooks.captureFrame] - **dev only**：保留入口，但主链路不主动触发；
 *     如需 PNG 路线，自行从 dev/index.js 引入 makeFrameWriter 并显式传入此 hook
 */
async function wrapCallApi(session, hint, fn, hooks){
  await callRawSafely(session, buildBeforeExpression(hint));

  let resp = null;
  let err = null;
  try {
    resp = await fn(hint);
  } catch (e) {
    err = e;
  }
  const buildSummary = hooks && typeof hooks.buildSummary === 'function' ? hooks.buildSummary : defaultBuildSummary;
  const summary = buildSummary(resp, hint, err);

  // post-2.7.0：抽业务数据 payload 塞进 summary（由 buildAfterExpression 透传到
  // bridge.after，bridge.after emit 时把 payload 写到 after event）
  if (hooks && typeof hooks.extractPayload === 'function') {
    try {
      const payload = hooks.extractPayload(resp, hint, err);
      if (payload && typeof payload === 'object') {
        summary.payload = payload;
      }
    } catch (_) { /* extractPayload 失败不阻断主流程 */ }
  }

  await callRawSafely(session, buildAfterExpression(hint, summary));

  // dev-only：如显式提供 hooks.captureFrame，仍触发一次 fire-and-forget 截图（不
  // 影响 events 内容、不收集 frames 元数据；A 路线主链路不消费）
  if (hooks && typeof hooks.captureFrame === 'function') {
    try {
      const ts = Date.now();
      const when = err ? 'error' : 'after';
      const info = { ts, when, frameRef: buildFrameRef(ts), hint, summary };
      safeCaptureFrame(hooks.captureFrame, info);
    } catch (_) {}
  }

  if (err) throw err;
  return resp;
}

function defaultBuildSummary(resp, hint, err){
  if (err) {
    return { ok: false, items: [], relate: [], errorCode: err.code || 'thrown', detail: err.message || '' };
  }
  if (!resp || typeof resp !== 'object') {
    return { ok: false, items: [], relate: [], errorCode: 'no_response', detail: '' };
  }
  if (resp.ok === false) {
    return {
      ok: false,
      items: [],
      relate: [],
      errorCode: resp.error || resp.code || 'unknown',
      detail: resp.message || '',
    };
  }
  return {
    ok: true,
    items: [],
    relate: [],
    errorCode: '',
    detail: '',
  };
}

/**
 * drainVisualEvents - 把 bridge 端 ring buffer 取回（破坏性读）。
 * 失败返回 []。
 */
async function drainVisualEvents(session){
  const events = await callRawSafely(session, buildDrainExpression());
  if (Array.isArray(events)) return events;
  return [];
}

/**
 * wrapInjectCall - 给 one-shot inject 模型用（每次工具调用是独立 executeScript，
 *                  没有长驻 bridge 的场景）。
 *
 * 区别于 wrapCallApi：
 *   - wrapCallApi 假定 visual.common.js 已 install 在 page world 中（reddit 那种长驻 bridge）
 *   - wrapInjectCall 每次 before 都把 visualKitSource 一并注入；installVisualBridgeKit
 *     的 IIFE 自带 __installed 短路锁，重复 inject 等于 0 成本
 *
 * 总成本：每次工具调用 +2 RTT（before+install 合并、after+drain 合并）。
 *
 * @param {object} ctx
 * @param {(expression: string, opts?: object) => Promise<any>} ctx.callRaw
 *        - 通常包装成 (expr) => browser.executeScript(tabId, expr)
 * @param {object} ctx.visualConfig - parseVisualFlags 输出的 config
 * @param {string} ctx.visualKitSource - visual.common.js + 站点 anchor resolver 拼接源码
 * @param {object} hint
 * @param {() => Promise<any>} fn - 真正的业务调用（一般是 browser.executeScript(tabId, businessIIFE)）
 * @param {object} [hooks] - { buildSummary?: (resp, hint, err) => summary }
 * @returns {Promise<{ result, events, durationMs, summary }>}
 */
async function wrapInjectCall(ctx, hint, fn, hooks){
  const startedAt = Date.now();
  if (!ctx || typeof ctx.callRaw !== 'function') {
    throw new Error('wrapInjectCall: ctx.callRaw is required');
  }
  if (typeof ctx.visualKitSource !== 'string' || !ctx.visualKitSource) {
    throw new Error('wrapInjectCall: ctx.visualKitSource is required');
  }
  const visualEnabled = !!(ctx.visualConfig && ctx.visualConfig.enabled !== false);
  const safeRaw = async (expression) => {
    try { return await ctx.callRaw(expression, { timeoutMs: 5000 }); }
    catch (_) { return null; }
  };

  if (visualEnabled) {
    const beforeBundle = ctx.visualKitSource
      + ';\n' + buildConfigExpression(ctx.visualConfig)
      + ';\n' + buildBeforeExpression(hint);
    await safeRaw(beforeBundle);
  }

  let result = null;
  let err = null;
  try { result = await fn(hint); }
  catch (e) { err = e; }

  const buildSummary = hooks && typeof hooks.buildSummary === 'function'
    ? hooks.buildSummary
    : defaultBuildSummary;
  const summary = buildSummary(result, hint, err);

  // post-2.7.0：业务数据 payload 走 summary.payload 透传到 bridge.after emit
  if (hooks && typeof hooks.extractPayload === 'function') {
    try {
      const payload = hooks.extractPayload(result, hint, err);
      if (payload && typeof payload === 'object') {
        summary.payload = payload;
      }
    } catch (_) {}
  }

  let events = [];
  if (visualEnabled) {
    const afterBundle = '(function(){'
      + buildAfterExpression(hint, summary) + ';'
      + 'return ' + buildDrainExpression() + ';'
      + '})()';
    const drained = await safeRaw(afterBundle);
    if (Array.isArray(drained)) events = drained;
  }

  // dev-only：显式 hooks.captureFrame 仍可触发；events 不再被自动 attach frameRef
  if (hooks && typeof hooks.captureFrame === 'function' && visualEnabled) {
    try {
      const ts = Date.now();
      const when = err ? 'error' : 'after';
      const info = { ts, when, frameRef: buildFrameRef(ts), hint, summary };
      safeCaptureFrame(hooks.captureFrame, info);
    } catch (_) {}
  }

  if (err) throw err;
  return { result, events, durationMs: Date.now() - startedAt, summary };
}

module.exports = {
  applyVisualConfig,
  wrapCallApi,
  wrapInjectCall,
  drainVisualEvents,
  buildBeforeExpression,
  buildAfterExpression,
  buildDrainExpression,
  buildConfigExpression,
  defaultBuildSummary,
  // Phase 2 capture-frame helpers
  buildFrameRef,
  attachFrameRefsToEvents,
};
