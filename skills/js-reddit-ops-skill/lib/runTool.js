'use strict';

const pkg = require('../package.json');
const { Session } = require('./session');
const { createRunContext } = require('./runContext');
const { appendHistory } = require('./history');
const { writeDebugBundle } = require('./debug');
const {
  wrapCallApi,
  drainVisualEvents,
  appendVisualTrace,
  appendVisualSession,
} = require('@js-eyes/visual-bridge-kit');
const { getVisualHint, buildSummary, extractPayload } = require('./visualHint');

const SKILL_ID = pkg.name;

/**
 * runTool - 通用 READ 工具调度器（不含 cache，仅 history + debug bundle）
 *
 * 与 lib/api.js::getPost 相比，runTool 是参数空间不可枚举的"轻量"工具入口：
 *   - 不做 cache（每次都打实际请求）；
 *   - history 记一行 jsonl，用 input_url=`reddit-tool://<tool>/?args=<json>` 占位；
 *   - --debug-recording 时写 debug bundle；
 *   - 失败也走 history（status=failed），方便回查。
 *
 * @returns {Promise<{ok:boolean, ...}>}
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

  const fakeUrl = `reddit-tool://${toolName}/?args=${encodeURIComponent(JSON.stringify(args || {}))}`;
  const runContext = createRunContext({
    skillId: SKILL_ID,
    scrapeType: toolName,
    skillVersion: pkg.version,
    url: fakeUrl,
    runId: options.runId,
    recording: options.recording,
    recordingMode: options.recordingMode,
    debugRecording: options.debugRecording,
    noCache: true,
  });

  const startedAt = Date.now();
  let response = null;
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
      reuseAnyRedditTab: options.reuseAnyRedditTab !== false,
      createUrl: options.createUrl || 'https://www.reddit.com/',
      visualConfig: options.visualConfig || null,
    },
  });

  const hint = getVisualHint(toolName, args);
  let drainedEvents = [];

  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    bridgeMeta = await session.ensureBridge();

    // post-2.7.0：主链路只挂 buildSummary + extractPayload；captureFrame 已下线
    // （如需 dev PNG 路线，自行 require('@js-eyes/visual-bridge-kit/dev').makeFrameWriter
    //  并显式传入 hooks.captureFrame）
    resp = await wrapCallApi(session, hint, async () => {
      return await session.callApi(method, [args || {}], {
        timeoutMs: options.timeoutMs || 90000,
      });
    }, {
      buildSummary: (r) => buildSummary(r, hint),
      extractPayload: (r, h, e) => extractPayload(r, Object.assign({}, hint, { args }), e),
    });
    try { drainedEvents = await drainVisualEvents(session); } catch (_) { drainedEvents = []; }
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    try { drainedEvents = await drainVisualEvents(session); } catch (_) {}
    if (runContext.recording.debugEnabled) {
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
    }
    appendHistory(runContext, {
      run_id: runContext.runId,
      skill_id: runContext.skillId,
      tool_name: toolName,
      timestamp: new Date().toISOString(),
      input_url: fakeUrl,
      normalized_url: runContext.normalizedUrl,
      status: 'failed',
      duration_ms: durationMs,
      cache_hit: false,
      cache_key: runContext.cacheKey,
      debug_bundle_path: debugBundlePath,
      error_summary: error.message,
    });
    const failedEntry = {
      runId: runContext.runId,
      skillId: runContext.skillId,
      toolName,
      args,
      hint,
      ok: false,
      durationMs,
      error: error.message,
      events: drainedEvents,
    };
    if (options.visualTrace) {
      try { appendVisualTrace(options.visualTrace, failedEntry); } catch (_) {}
    }
    if (options.visualRecord) {
      try { appendVisualSession(options.visualRecord, failedEntry, { skillId: runContext.skillId, skillVersion: pkg.version }); } catch (_) {}
    }
    throw error;
  } finally {
    await session.close();
  }

  const durationMs = Date.now() - startedAt;
  const ok = !!(resp && resp.ok);
  response = {
    platform: 'reddit',
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
  }

  appendHistory(runContext, {
    run_id: runContext.runId,
    skill_id: runContext.skillId,
    tool_name: toolName,
    timestamp: new Date().toISOString(),
    input_url: fakeUrl,
    normalized_url: runContext.normalizedUrl,
    status: ok ? 'success' : 'failed',
    duration_ms: durationMs,
    cache_hit: false,
    cache_key: runContext.cacheKey,
    debug_bundle_path: debugBundlePath,
    error_summary: ok ? '' : ((response.error && response.error.code) || ''),
  });

  const successEntry = {
    runId: runContext.runId,
    skillId: runContext.skillId,
    toolName,
    args,
    hint,
    ok,
    durationMs,
    events: drainedEvents,
  };
  if (options.visualTrace) {
    try { appendVisualTrace(options.visualTrace, successEntry); } catch (_) {}
  }
  if (options.visualRecord) {
    try { appendVisualSession(options.visualRecord, successEntry, { skillId: runContext.skillId, skillVersion: pkg.version }); } catch (_) {}
  }

  return response;
}

module.exports = { runTool };
