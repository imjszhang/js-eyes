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
// v3.7.0 dom-first：当 dom_<method> 主动报这些 error code 时，auto 模式回退 api_<method>
const FALLBACK_ERRORS = new Set([
  'dom_unstable',
  'dom_timeout',
  'dom_navigation_failed',
  'dom_navigation_required',
  'dom_extract_failed',
  'dom_not_found',
  'method_not_found',
  'bridge_not_installed',
  'bridge_returned_non_object',
]);

function buildTryOrder(method, mode, cmdDef) {
  // 兼容老命令：未声明 domSupported/apiSupported 视为 dom=false / api=true
  const domSupported = !!(cmdDef && cmdDef.domSupported);
  const apiSupported = cmdDef && cmdDef.apiSupported === false ? false : true;
  const apiCandidates = apiSupported ? [`api_${method}`, method] : [method];
  if (mode === 'dom') {
    return domSupported ? [`dom_${method}`] : apiCandidates;
  }
  if (mode === 'api') {
    return apiCandidates;
  }
  // auto：dom 优先，失败回退 api
  if (domSupported) {
    return [`dom_${method}`, ...apiCandidates];
  }
  return apiCandidates;
}

async function runTool(browser, spec) {
  const {
    toolName,
    pageKey,
    method,
    args = {},
    targetUrl = null,
    cmdDef = null,
    options = {},
  } = spec || {};

  if (!toolName || !pageKey || !method) {
    throw new Error('runTool: toolName/pageKey/method are required');
  }

  const requestedMode = options.mode
    || (cmdDef && cmdDef.defaultMode)
    || 'auto';
  const tryOrder = buildTryOrder(method, requestedMode, cmdDef);

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
  const triedMethods = [];
  let usedMethod = null;
  let usedMode = null;
  let fellBack = false;

  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    bridgeMeta = await session.ensureBridge();

    // post-2.7.0：主链路只挂 buildSummary + extractPayload；captureFrame 已下线
    // （如需 dev PNG 路线，自行 require('@js-eyes/visual-bridge-kit/dev').makeFrameWriter
    //  并显式传入 hooks.captureFrame）
    // v3.7.0 dom-first：按 tryOrder 依次尝试，失败且属于 FALLBACK_ERRORS 时回退下一个候选；
    // 内层处理 'dom_navigation_required'：bridge 主动报需要先导航，runTool 借现有 api 路径
    // location.assign + awaitBridgeAfterNav + ensureBridge 后重试同一 candidate（最多一次）。
    for (let i = 0; i < tryOrder.length; i++) {
      const candidate = tryOrder[i];
      triedMethods.push(candidate);

      let navAttempts = 0;
      while (true) {
        resp = await wrapCallApi(session, hint, async () => {
          return await session.callApi(candidate, [args || {}], {
            timeoutMs: options.timeoutMs || 90000,
          });
        }, {
          buildSummary: (r) => buildSummary(r, hint),
          extractPayload: (r, h, e) => extractPayload(r, Object.assign({}, hint, { args }), e),
        });
        usedMethod = candidate;
        usedMode = candidate.startsWith('dom_') ? 'dom' : 'api';
        if (resp && resp.ok) break;
        if (
          candidate.indexOf('dom_') === 0 &&
          resp && resp.error === 'dom_navigation_required' &&
          resp.to && navAttempts < 1
        ) {
          navAttempts += 1;
          // 在 location.assign 卸载页面之前先把 dom_navigate / dom_type 等 emit 收掉
          try {
            const pre = await drainVisualEvents(session);
            if (Array.isArray(pre) && pre.length) {
              drainedEvents = drainedEvents.concat(pre);
            }
          } catch (_) {}
          const navMethod = resp.navMethod || null;
          const navArgs = resp.navArgs || {};
          const fromUrl = target && target.url ? target.url : null;
          if (navMethod) {
            try {
              await session.callApi(navMethod, [navArgs], { timeoutMs: 12000 });
            } catch (_) { /* navigation 中断；callApi 可能 timeout，吞掉 */ }
          }
          await session.awaitBridgeAfterNav({
            timeoutMs: 20000,
            intervalMs: 500,
            initialDelayMs: 600,
            fromUrl,
            expectedUrl: resp.to,
          });
          try {
            bridgeMeta = await session.ensureBridge();
            target = session.target;
          } catch (_) {}
          // 同一 candidate 重试
          continue;
        }
        break;
      }

      if (resp && resp.ok) break;
      if (i === tryOrder.length - 1) break;
      const errCode = resp && resp.error;
      if (!FALLBACK_ERRORS.has(errCode)) break;
      fellBack = true;
    }
    try {
      const tail = await drainVisualEvents(session);
      if (Array.isArray(tail) && tail.length) drainedEvents = drainedEvents.concat(tail);
    } catch (_) { /* keep accumulated drainedEvents */ }
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    try {
      const tail = await drainVisualEvents(session);
      if (Array.isArray(tail) && tail.length) drainedEvents = drainedEvents.concat(tail);
    } catch (_) {}
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
    mode: usedMode,
    requestedMode,
    fallback: fellBack,
    triedMethods,
    usedMethod,
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
