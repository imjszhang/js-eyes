'use strict';

const pkg = require('../package.json');
const { Session } = require('./session');
const { createRunContext } = require('./runContext');
const { appendHistory } = require('./history');
const { writeDebugBundle } = require('./debug');
const { runSearch } = require('./searchRunner');
const { sanitizeForRecording, summarizeInput } = require('./sanitize');

const SKILL_ID = pkg.name;
const SEARCH_TOOLS = new Set([
  'google_search',
  'google_search_news',
  'google_search_images',
  'google_search_scholar',
]);

function pageKeyForVertical(vertical) {
  return vertical === 'scholar' ? 'scholar' : 'search';
}

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

  const fakeUrl = `google-tool://${toolName}/?q=${encodeURIComponent((args && (args.query || args.q)) || '')}`;
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
  let payload = null;
  let ok = false;

  const isSearch = SEARCH_TOOLS.has(toolName) || method === 'extractPage';
  const session = new Session({
    opts: {
      page: pageKey || pageKeyForVertical(args.vertical),
      bot: browser,
      targetUrl: targetUrl || null,
      verbose: !!options.verbose,
      tab: options.tab != null ? options.tab : null,
      wsEndpoint: options.wsEndpoint || null,
      createIfMissing: options.createIfMissing !== false,
      navigateOnReuse: options.navigateOnReuse === true,
      reuseAnyGoogleTab: options.reuseAnyGoogleTab === true,
      forceNewTab: options.forceNewTab === true,
      closeCreatedTab: options.closeCreatedTab !== false,
      createUrl: options.createUrl || targetUrl || 'https://www.google.com/',
    },
  });

  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    if (isSearch) {
      const result = await runSearch(session, args, {
        timeoutMs: options.timeoutMs || 90000,
        throttleMs: options.throttleMs,
      });
      bridgeMeta = { version: session._bridgeVersionCache || null };
      ok = result.items.length > 0
        || !result.blocker
        || result.blocker.kind === 'no_results';
      if (result.blocker && (result.blocker.kind === 'consent_required' || result.blocker.kind === 'captcha_required')) {
        ok = result.items.length > 0;
      }
      payload = result;
    } else {
      bridgeMeta = await session.ensureBridge();
      const resp = await session.callApi(method, [args || {}], { timeoutMs: options.timeoutMs || 30000 });
      ok = !!(resp && resp.ok);
      payload = resp;
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (runContext.recording.debugEnabled) {
      debugBundlePath = writeDebugBundle(runContext, {
        meta: {
          runId: runContext.runId,
          skillId: runContext.skillId,
          scrapeType: toolName,
          args: sanitizeForRecording(args),
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
      input_summary: summarizeInput(args),
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
  const response = {
    platform: 'google',
    toolName,
    vertical: (payload && payload.vertical) || args.vertical || null,
    query: (payload && payload.query) || args.query || args.q || null,
    pageKey,
    method,
    timestamp: new Date().toISOString(),
    sourceUrl: target && target.url ? target.url : (targetUrl || null),
    run: {
      id: runContext.runId,
      durationMs,
      recordingMode: runContext.recording.mode,
      createdTab: !!(target && target._created),
    },
    bridge: bridgeMeta,
    ok,
    items: payload && payload.items ? payload.items : undefined,
    pageInfo: payload && payload.pageInfo ? payload.pageInfo : undefined,
    blocker: payload && payload.blocker ? payload.blocker : undefined,
    data: isSearch ? undefined : (payload && payload.data != null ? payload.data : payload),
    error: ok ? null : {
      code: (payload && payload.blocker && payload.blocker.kind)
        || (payload && payload.error)
        || 'unknown',
      message: (payload && payload.blocker && payload.blocker.reason) || null,
    },
  };

  if (runContext.recording.debugEnabled) {
    debugBundlePath = writeDebugBundle(runContext, {
      meta: {
        runId: runContext.runId,
        skillId: runContext.skillId,
        scrapeType: toolName,
        args: sanitizeForRecording(args),
        target: sanitizeForRecording(target),
        bridge: bridgeMeta,
      },
      steps: [{ stage: 'tool_called', durationMs, bridge: bridgeMeta }],
      result: sanitizeForRecording({
        ok: response.ok,
        vertical: response.vertical,
        query: response.query,
        returnedCount: response.pageInfo && response.pageInfo.returnedCount,
        blocker: response.blocker,
      }),
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
    input_summary: summarizeInput(args),
    status: ok ? 'success' : 'failed',
    duration_ms: durationMs,
    cache_hit: false,
    cache_key: runContext.cacheKey,
    debug_bundle_path: debugBundlePath,
    error_summary: ok ? '' : ((response.error && response.error.code) || ''),
  });

  return response;
}

module.exports = { runTool, SEARCH_TOOLS, pageKeyForVertical };
