'use strict';

const path = require('path');
const pkg = require('../package.json');
const { Session } = require('./session');
const {
  appendHistory,
  createSkillRunContext,
  readCacheEntry,
  writeCacheEntry,
  writeDebugBundle,
} = require('@js-eyes/skill-recording');
const { getSharedLimiter } = require('./rateLimit/limiter');

const SKILL_ID = pkg.name;

const FALLBACK_ERRORS = new Set([
  'dom_unstable',
  'dom_timeout',
  'dom_navigation_failed',
  'dom_extract_failed',
  'dom_not_found',
  'method_not_found',
  'bridge_not_installed',
  'bridge_returned_non_object',
  'captcha_required',
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sanitizeForRecording(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(sanitizeForRecording);
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/cookie|token|auth|z_c0|d_c0|q_c1/i.test(key)) out[key] = '[MASKED]';
    else out[key] = sanitizeForRecording(item);
  }
  return out;
}

function summarizeInput(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

function normalizeReadMode(mode) {
  const m = String(mode || 'auto').toLowerCase();
  if (m === 'dom') return 'dom';
  if (m === 'api') return 'api';
  return 'auto';
}

function candidateModeLabel(candidate) {
  if (String(candidate).indexOf('dom_') === 0) return 'dom';
  if (String(candidate).indexOf('api_') === 0) return 'api';
  return 'dom';
}

function buildTryOrder(method, modeNorm, cmdDef) {
  if (!cmdDef || cmdDef.legacyOnly) return [method];
  const base = cmdDef.methodBase || method;
  const domSupported = cmdDef.domSupported !== false;
  const apiSupported = cmdDef.apiSupported === true;
  const domMethod = `dom_${base}`;
  const apiMethod = `api_${base}`;
  if (modeNorm === 'dom') return domSupported ? [domMethod, base] : [base];
  if (modeNorm === 'api') return apiSupported ? [apiMethod, base] : [base];
  const order = [];
  if (domSupported) order.push(domMethod);
  if (apiSupported) order.push(apiMethod);
  order.push(base);
  return Array.from(new Set(order));
}

function shouldFallBack(errCode, modeNorm, hasOtherPath) {
  if (!hasOtherPath || modeNorm !== 'auto') return false;
  return FALLBACK_ERRORS.has(errCode);
}

function parseOptionalInt(value) {
  const parsed = Number.parseInt(String(value || '').replace(/[^\d-]/g, ''), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function buildMetrics(result, durationMs, cacheHit) {
  const content = result && (result.content || result.excerpt || '');
  return {
    status: 'success',
    durationMs,
    cacheHit,
    contentLength: String(content || '').length,
    upvoteCount: parseOptionalInt(result && result.upvote_count),
    commentCount: parseOptionalInt(result && result.comment_count),
  };
}

function classifyAntiCrawl(resp) {
  const code = resp && resp.error;
  if (!code) return { paused: false, reason: null };
  if (code === 'captcha_required') return { paused: true, reason: code };
  if (code === 'login_required') return { paused: false, reason: code };
  return { paused: false, reason: code };
}

function attachCacheHitResponse(runContext, cached, startedAtMs) {
  if (!cached || !cached.response) return null;
  const response = clone(cached.response);
  const durationMs = Date.now() - startedAtMs;
  response.run = Object.assign({}, response.run || {}, {
    id: runContext.runId,
    cacheHit: true,
    recordingMode: runContext.recording.mode,
  });
  response.cache = Object.assign({}, response.cache || {}, {
    hit: true,
    key: runContext.cacheKey,
    createdAt: cached.createdAt || null,
    expiresAt: cached.expiresAt || null,
  });
  response.metrics = Object.assign({}, response.metrics || {}, { cacheHit: true, durationMs });
  appendHistory(runContext, {
    run_id: runContext.runId,
    skill_id: runContext.skillId,
    tool_name: runContext.toolName || runContext.scrapeType,
    timestamp: new Date().toISOString(),
    input_summary: summarizeInput(sanitizeForRecording(runContext.normalizedInput)),
    status: 'success',
    duration_ms: durationMs,
    cache_hit: true,
    cache_key: runContext.cacheKey,
    debug_bundle_path: '',
    error_summary: '',
  });
  return response;
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
  if (!toolName || !pageKey || !method) throw new Error('runTool: toolName/pageKey/method are required');

  const requestedReadModeRaw = options.readMode || (cmdDef && cmdDef.defaultReadMode) || 'auto';
  const modeNorm = normalizeReadMode(requestedReadModeRaw);
  const tryOrder = buildTryOrder(method, modeNorm, cmdDef);
  const runContext = createSkillRunContext({
    skillId: SKILL_ID,
    toolName,
    scrapeType: toolName,
    skillVersion: pkg.version,
    input: { args: args || {}, targetUrl, pageKey, method },
    runId: options.runId,
    recording: options.recording,
    recordingMode: options.recordingMode,
    debugRecording: options.debugRecording,
    noCache: options.noCache,
    normalizeInput: (value) => value,
    buildCacheKeyParts: ({ skillId, toolName: tn, normalizedInput, skillVersion }) => ({
      skillId,
      toolName: tn,
      input: normalizedInput,
      version: skillVersion,
      readMode: requestedReadModeRaw,
    }),
  });
  const startedAt = Date.now();
  const cacheNamespace = options.cacheNamespace || toolName;
  if (!options.noCache) {
    const cached = readCacheEntry(runContext, cacheNamespace);
    const cachedResponse = attachCacheHitResponse(runContext, cached, startedAt);
    if (cachedResponse) return cachedResponse;
  }

  const session = new Session({
    opts: {
      page: pageKey,
      bot: browser,
      targetUrl,
      verbose: !!options.verbose,
      tab: options.tab != null ? options.tab : null,
      wsEndpoint: options.wsEndpoint || null,
      createIfMissing: options.createIfMissing !== false,
      navigateOnReuse: options.navigateOnReuse === true,
      reuseAnyZhihuTab: options.reuseAnyZhihuTab !== false,
      createUrl: options.createUrl || targetUrl || 'https://www.zhihu.com/',
    },
  });

  let debugBundlePath = '';
  let bridgeMeta = null;
  let target = null;
  let resp = null;
  let triedMethods = [];
  let usedMethod = null;
  let usedMode = null;
  let fellBack = false;
  const limiter = (options.rateLimit === true || process.env.JS_ZHIHU_RATE_LIMIT === '1')
    ? getSharedLimiter(options.rateLimitOptions || {})
    : null;

  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    bridgeMeta = await session.ensureBridge();

    const runCallApi = async (candidate) => {
      const call = () => session.callApi(candidate, [args || {}], { timeoutMs: options.timeoutMs || 90000 });
      return limiter ? limiter.schedule(call) : call();
    };

    outer: for (let i = 0; i < tryOrder.length; i++) {
      const candidate = tryOrder[i];
      triedMethods.push(candidate);
      resp = await runCallApi(candidate);
      usedMethod = candidate;
      usedMode = candidateModeLabel(candidate);

      if (resp && resp.error === 'dom_navigation_required' && resp.to) {
        const fromUrl = target && target.url;
        if (resp.navMethod) {
          try { await session.callApi(resp.navMethod, [resp.navArgs || args || {}], { timeoutMs: 12000 }); } catch (_) {}
        }
        // Host-side navigation is the reliable fallback when page-world location.assign
        // is ignored by SPA/router state or browser policy timing.
        try { await browser.openUrl(resp.to, target.rawId); } catch (_) {}
        const postNav = await session.awaitBridgeAfterNav({
          timeoutMs: 20000,
          intervalMs: 500,
          initialDelayMs: 600,
          fromUrl,
          expectedUrl: resp.to,
        });
        if (postNav && postNav.currentUrl && target) target.url = postNav.currentUrl;
        bridgeMeta = await session.ensureBridge();
        target = session.target;
        resp = await runCallApi(candidate);
      }

      if (resp && resp.ok) break outer;
      const hasOtherPath = (i + 1) < tryOrder.length;
      if (!shouldFallBack(resp && resp.error, modeNorm, hasOtherPath)) break outer;
      fellBack = true;
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (runContext.recording.debugEnabled) {
      try {
        debugBundlePath = writeDebugBundle(runContext, {
          meta: {
            runId: runContext.runId,
            skillId: runContext.skillId,
            toolName,
            args: sanitizeForRecording(args),
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
      input_summary: summarizeInput(sanitizeForRecording(runContext.normalizedInput)),
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
  const result = ok ? (resp.data == null ? null : resp.data) : null;
  const scrapeType = toolName;
  const response = {
    platform: 'zhihu',
    scrapeType,
    toolName,
    pageKey,
    method,
    timestamp: new Date().toISOString(),
    sourceUrl: (result && result.source_url) || (target && target.url) || targetUrl || null,
    run: {
      id: runContext.runId,
      cacheHit: false,
      recordingMode: runContext.recording.mode,
      durationMs,
      target,
      paths: runContext.paths ? {
        historyDir: runContext.paths.historyDir,
        cacheDir: runContext.paths.cacheDir,
        debugDir: runContext.paths.debugDir,
        historyFile: runContext.paths.historyDir
          ? path.join(runContext.paths.historyDir, new Date().toISOString().slice(0, 7) + '.jsonl')
          : null,
      } : null,
    },
    cache: {
      hit: false,
      key: runContext.cacheKey,
      createdAt: null,
      expiresAt: null,
    },
    metrics: buildMetrics(result || {}, durationMs, false),
    bridge: bridgeMeta,
    ok,
    readMode: usedMode,
    requestedReadMode: requestedReadModeRaw,
    fallback: fellBack,
    triedMethods,
    usedMethod,
    antiCrawlState: classifyAntiCrawl(resp),
    visual: options.visualConfig || options.visualTrace || options.visualRecord ? {
      enabled: true,
      hint: { toolName, label: toolName, anchor: args || {} },
      events: [],
      eventsCount: 0,
      traceFile: options.visualTrace || null,
      recordDir: options.visualRecord || null,
      framesEnabled: false,
    } : null,
    result,
    error: ok ? null : {
      code: (resp && resp.error) || 'unknown',
      message: (resp && resp.message) || null,
      detail: resp || null,
    },
  };

  if (ok && !options.noCache) {
    const cacheEntry = writeCacheEntry(runContext, { response }, cacheNamespace);
    if (cacheEntry) {
      response.cache.createdAt = cacheEntry.createdAt;
      response.cache.expiresAt = cacheEntry.expiresAt;
    }
  }

  if (runContext.recording.debugEnabled) {
    try {
      debugBundlePath = writeDebugBundle(runContext, {
        meta: {
          runId: runContext.runId,
          skillId: runContext.skillId,
          toolName,
          args: sanitizeForRecording(args),
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
    input_summary: summarizeInput(sanitizeForRecording(runContext.normalizedInput)),
    status: ok ? 'success' : 'failed',
    duration_ms: durationMs,
    cache_hit: false,
    cache_key: runContext.cacheKey,
    debug_bundle_path: debugBundlePath,
    error_summary: ok ? '' : ((response.error && response.error.code) || ''),
  });

  return response;
}

module.exports = {
  runTool,
  buildTryOrder,
  normalizeReadMode,
  FALLBACK_ERRORS,
  sanitizeForRecording,
};
