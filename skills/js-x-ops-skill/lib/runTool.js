'use strict';

const pkg = require('../package.json');
const { Session } = require('./session');
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
 * runTool - 通用 READ 工具调度器（不含 cache，仅 history + debug bundle）
 *
 * 与 lib/api.js 的 4 个老入口（searchTweets/getProfileTweets/getPost/getHomeFeed）相比，
 * runTool 是参数空间不可枚举的"轻量"工具入口：
 *   - 不做 cache（每次都打实际请求）；
 *   - history 记一行 jsonl；
 *   - --debug-recording 时写 debug bundle；
 *   - 失败也走 history（status=failed），方便回查。
 *
 * @param {import('./js-eyes-client').BrowserAutomation} browser
 * @param {Object} spec
 * @param {string} spec.toolName  例如 'x_search_tweets' / 'x_navigate_search'
 * @param {string} spec.pageKey   profile 名（search/profile/post/home）
 * @param {string} spec.method    bridge 方法名
 * @param {Object} [spec.args]    bridge 方法参数
 * @param {string|null} [spec.targetUrl] 目标 URL（用于 resolveTarget 的精确匹配/导航）
 * @param {Object} [spec.options]
 * @returns {Promise<Object>}
 */
async function runTool(browser, spec) {
  const {
    toolName,
    pageKey,
    method,
    args = {},
    targetUrl = null,
    options = {},
  } = spec || {};

  if (!toolName || !pageKey || !method) {
    throw new Error('runTool: toolName/pageKey/method are required');
  }

  const fakeUrl = `x-tool://${toolName}/?args=${encodeURIComponent(JSON.stringify(args || {}))}`;
  const runContext = createSkillRunContext({
    skillId: SKILL_ID,
    toolName,
    scrapeType: toolName,
    skillVersion: pkg.version,
    input: { args: args || {}, targetUrl, pageKey, method },
    recording: options.recording,
    recordingMode: options.recordingMode,
    debugRecording: options.debugRecording,
    noCache: true,
    normalizeInput: (value) => value,
    buildCacheKeyParts: ({ skillId, toolName: tn, normalizedInput, skillVersion }) => ({
      skillId,
      toolName: tn,
      input: normalizedInput,
      version: skillVersion,
    }),
  });

  const startedAt = Date.now();
  let debugBundlePath = '';
  let bridgeMeta = null;
  let target = null;
  let resp = null;

  const session = new Session({
    opts: {
      page: pageKey,
      bot: browser,
      targetUrl: targetUrl || null,
      verbose: !!options.verbose,
      tab: options.tab != null ? options.tab : null,
      wsEndpoint: options.wsEndpoint || null,
      createIfMissing: options.createIfMissing !== false,
      navigateOnReuse: options.navigateOnReuse === true,
      reuseAnyXTab: options.reuseAnyXTab !== false,
      createUrl: options.createUrl || 'https://x.com/',
    },
  });

  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    bridgeMeta = await session.ensureBridge();
    resp = await session.callApi(method, [args || {}], {
      timeoutMs: options.timeoutMs || 90000,
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (runContext.recording.debugEnabled) {
      try {
        debugBundlePath = writeDebugBundle(runContext, {
          meta: {
            runId: runContext.runId,
            skillId: runContext.skillId,
            scrapeType: toolName,
            sourceUrl: fakeUrl,
            args,
            target,
            bridge: bridgeMeta,
            error: error.message,
          },
          steps: [{ stage: 'tool_failed', durationMs, error: error.message }],
          result: { error: error.message },
        }) || '';
      } catch (_) {}
    }
    appendHistory(runContext, {
      run_id: runContext.runId,
      skill_id: runContext.skillId,
      tool_name: toolName,
      timestamp: new Date().toISOString(),
      input_summary: summarizeInput(runContext.normalizedInput),
      status: 'failed',
      duration_ms: durationMs,
      cache_hit: false,
      cache_key: runContext.cacheKey,
      debug_bundle_path: debugBundlePath,
      error_summary: error.message || String(error),
    });
    throw error;
  } finally {
    await session.close();
  }

  const durationMs = Date.now() - startedAt;
  const ok = !!(resp && resp.ok);
  const response = {
    platform: 'x',
    toolName,
    pageKey,
    method,
    timestamp: new Date().toISOString(),
    sourceUrl: target && target.url ? target.url : (targetUrl || null),
    run: {
      id: runContext.runId,
      durationMs,
      recordingMode: runContext.recording.mode,
      target,
    },
    bridge: bridgeMeta,
    ok,
    result: ok ? (resp.data == null ? null : resp.data) : null,
    error: ok ? null : {
      code: (resp && resp.error) || 'unknown',
      message: (resp && resp.message) || null,
      detail: resp || null,
    },
  };

  if (runContext.recording.debugEnabled) {
    try {
      debugBundlePath = writeDebugBundle(runContext, {
        meta: {
          runId: runContext.runId,
          skillId: runContext.skillId,
          scrapeType: toolName,
          sourceUrl: fakeUrl,
          args,
          target,
          bridge: bridgeMeta,
        },
        steps: [{ stage: 'tool_called', durationMs, bridge: bridgeMeta, target }],
        result: response,
      }) || '';
      response.debug = { bundlePath: debugBundlePath };
    } catch (_) {}
  }

  appendHistory(runContext, {
    run_id: runContext.runId,
    skill_id: runContext.skillId,
    tool_name: toolName,
    timestamp: new Date().toISOString(),
    input_summary: summarizeInput(runContext.normalizedInput),
    status: ok ? 'success' : 'failed',
    duration_ms: durationMs,
    cache_hit: false,
    cache_key: runContext.cacheKey,
    debug_bundle_path: debugBundlePath,
    error_summary: ok ? '' : ((response.error && response.error.code) || ''),
  });

  return response;
}

module.exports = { runTool };
