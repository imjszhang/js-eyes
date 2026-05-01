'use strict';

/**
 * runMonitor - 对 AI 暴露的 monitor 工具走这里的通用 wrapper
 *
 * 仿 lib/runTool.js：
 *   - 不走 cache（monitor 语义天然与 cache 冲突）
 *   - history 记一行 JSONL（JS X Ops 共享的 skill-recording）
 *   - debug mode 时写 debug bundle，持有 runtime 执行细节（account-level / dedup 明细）
 *   - handler 永远不抛到顶层；失败走 status='failed'
 *
 * 工具执行函数契约：async (runtimeConfig, params) => { ok, ...payload }
 */

const pkg = require('../package.json');
const {
  appendHistory,
  createSkillRunContext,
  writeDebugBundle,
} = require('@js-eyes/skill-recording');

const SKILL_ID = pkg.name;

function summarizeInput(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

/**
 * @param {Object} spec
 * @param {string} spec.toolName           'x_monitor_list_accounts' 等
 * @param {Object} spec.input              AI 传入的参数
 * @param {Function} spec.handler          async ({ input, debugSteps }) => result object
 * @param {Object} [spec.options]          { recording, recordingMode, debugRecording, runId }
 */
async function runMonitor(spec) {
  const { toolName, input = {}, handler, options = {} } = spec || {};
  if (!toolName || typeof handler !== 'function') {
    throw new Error('runMonitor: toolName/handler required');
  }

  const runContext = createSkillRunContext({
    skillId: SKILL_ID,
    toolName,
    scrapeType: toolName,
    skillVersion: pkg.version,
    input,
    recording: options.recording,
    recordingMode: options.recordingMode,
    debugRecording: options.debugRecording,
    noCache: true,
    normalizeInput: (value) => value,
    buildCacheKeyParts: ({ skillId, toolName: tn, normalizedInput, skillVersion }) => ({
      skillId, toolName: tn, input: normalizedInput, version: skillVersion,
    }),
  });

  const startedAt = Date.now();
  const debugSteps = [];
  let result = null;
  let status = 'success';
  let errorSummary = '';
  let debugBundlePath = '';

  try {
    result = await handler({ input, debugSteps, runId: runContext.runId });
    if (result && result.ok === false) {
      status = 'failed';
      errorSummary = result.error?.code || result.error?.message || result.error || '';
    }
  } catch (err) {
    status = 'failed';
    errorSummary = err.message || String(err);
    result = { ok: false, error: { message: err.message, code: err.code || null } };
    debugSteps.push({ stage: 'handler_threw', error: err.message });
  }

  const durationMs = Date.now() - startedAt;

  if (runContext.recording.debugEnabled) {
    try {
      debugBundlePath = writeDebugBundle(runContext, {
        meta: {
          runId: runContext.runId,
          skillId: runContext.skillId,
          scrapeType: toolName,
          input,
          recordingMode: runContext.recording.mode,
          durationMs,
          status,
        },
        steps: debugSteps,
        result,
      }) || '';
    } catch (_) { /* ignore */ }
  }

  appendHistory(runContext, {
    run_id: runContext.runId,
    skill_id: runContext.skillId,
    tool_name: toolName,
    timestamp: new Date().toISOString(),
    input_summary: summarizeInput(runContext.normalizedInput),
    status,
    duration_ms: durationMs,
    cache_hit: false,
    cache_key: runContext.cacheKey,
    debug_bundle_path: debugBundlePath,
    error_summary: errorSummary,
  });

  const envelope = {
    platform: 'x',
    toolName,
    timestamp: new Date().toISOString(),
    run: {
      id: runContext.runId,
      durationMs,
      recordingMode: runContext.recording.mode,
    },
    status,
    ok: status === 'success' && (result?.ok !== false),
    result,
  };
  if (debugBundlePath) envelope.debug = { bundlePath: debugBundlePath };
  return envelope;
}

module.exports = { runMonitor };
