'use strict';

const pkg = require('../package.json');
const { Session } = require('./session');
const { createRunContext } = require('./runContext');
const { appendHistory } = require('./history');
const { writeDebugBundle } = require('./debug');

const SKILL_ID = pkg.name;

const FALLBACK_ERRORS = new Set([
  'fetch_stories_failed',
  'fetch_item_failed',
  'fetch_user_failed',
  'algolia_fetch_failed',
  'dom_not_supported_for_search',
  'method_not_found',
  'bridge_not_installed',
  'bridge_returned_non_object',
]);

function buildTryOrder(method, mode, cmdDef) {
  const domSupported = !!(cmdDef && cmdDef.domSupported);
  const apiSupported = cmdDef && cmdDef.apiSupported === false ? false : true;
  const apiCandidates = apiSupported ? [`api_${method}`, method] : [method];
  if (mode === 'dom') {
    return domSupported ? [`dom_${method}`] : apiCandidates;
  }
  if (mode === 'api') {
    return apiCandidates;
  }
  // auto：API 优先（Firebase/Algolia 不依赖当前页 DOM），失败回退 dom
  if (domSupported) {
    return [...apiCandidates, `dom_${method}`];
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

  const requestedReadMode = options.readMode
    || (cmdDef && cmdDef.defaultReadMode)
    || (args && args.readMode)
    || 'auto';
  const tryOrder = buildTryOrder(method, requestedReadMode, cmdDef);

  const fakeUrl = `hn-tool://${toolName}/?args=${encodeURIComponent(JSON.stringify(args || {}))}`;
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
  let debugBundlePath = '';
  let bridgeMeta = null;
  let target = null;
  let resp = null;
  let usedMethod = null;
  let usedMode = null;
  let fellBack = false;
  let bridgeFallbackReason = null;

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
      reuseAnyHnTab: options.reuseAnyHnTab !== false,
      createUrl: options.createUrl || 'https://news.ycombinator.com/news',
    },
  });

  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    bridgeMeta = await session.ensureBridge();

    for (let i = 0; i < tryOrder.length; i++) {
      const m = tryOrder[i];
      const candidate = await session.callApi(m, [args || {}], {
        timeoutMs: options.timeoutMs || 120000,
      });
      if (candidate && candidate.ok) {
        resp = candidate;
        usedMethod = m;
        usedMode = m.startsWith('dom_') ? 'dom' : (m.startsWith('api_') ? 'api' : 'bridge');
        fellBack = i > 0;
        break;
      }
      if (requestedReadMode === 'auto' && i < tryOrder.length - 1 && FALLBACK_ERRORS.has(candidate && candidate.error)) {
        bridgeFallbackReason = candidate.error;
        continue;
      }
      if (requestedReadMode !== 'auto' || i === tryOrder.length - 1) {
        resp = candidate;
        usedMethod = m;
        usedMode = m.startsWith('dom_') ? 'dom' : (m.startsWith('api_') ? 'api' : 'bridge');
        break;
      }
      bridgeFallbackReason = candidate && candidate.error;
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt;
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
    throw error;
  } finally {
    await session.close();
  }

  const durationMs = Date.now() - startedAt;
  const ok = !!(resp && resp.ok);
  const resultData = ok ? (resp.data == null ? null : resp.data) : null;
  const metaFallback = resultData && resultData.meta && resultData.meta.bridgeFallbackReason;
  const response = {
    platform: 'hackernews',
    toolName,
    pageKey,
    method,
    usedMethod,
    readMode: usedMode || requestedReadMode,
    bridgeFallbackReason: metaFallback || (fellBack ? bridgeFallbackReason : null),
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
    data: resultData,
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
      steps: [{ stage: 'tool_called', durationMs, bridge: bridgeMeta, target, usedMethod }],
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

  return response;
}

module.exports = { runTool, buildTryOrder, FALLBACK_ERRORS };
