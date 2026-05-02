'use strict';

// @js-eyes/visual-bridge-kit · node/runVisual.js
// ---------------------------------------------------------------------------
// before/after hook，包在 session.callApi 两端。
//
// 用法：
//   const summary = await wrapCallApi(session, hint, async () => {
//     return await session.callApi(method, [args]);
//   });
//   const events = await drainVisualEvents(session);
//   appendVisualTrace(tracePath, { runId, toolName, args, hint, summary, events });
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
 * @param {object} [hooks] - { buildSummary(resp, hint) => summary }
 */
async function wrapCallApi(session, hint, fn, hooks){
  const before = buildBeforeExpression(hint);
  await callRawSafely(session, before);
  let resp = null;
  let err = null;
  try {
    resp = await fn(hint);
  } catch (e) {
    err = e;
  }
  const buildSummary = hooks && typeof hooks.buildSummary === 'function' ? hooks.buildSummary : defaultBuildSummary;
  const summary = buildSummary(resp, hint, err);
  await callRawSafely(session, buildAfterExpression(hint, summary));
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

  let events = [];
  if (visualEnabled) {
    const afterBundle = '(function(){'
      + buildAfterExpression(hint, summary) + ';'
      + 'return ' + buildDrainExpression() + ';'
      + '})()';
    const drained = await safeRaw(afterBundle);
    if (Array.isArray(drained)) events = drained;
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
};
