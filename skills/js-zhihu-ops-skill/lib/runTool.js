'use strict';

const path = require('path');
const fs = require('fs');
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
const { wrapCallApi, drainVisualEvents } = require('@js-eyes/visual-bridge-kit');
const { getVisualHint, buildSummary, extractPayload } = require('./visualHint');

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

function ensureDir(dirPath) {
  if (!dirPath) return null;
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function safeJsonlAppend(filePath, rows) {
  if (!filePath || !Array.isArray(rows) || rows.length === 0) return;
  ensureDir(path.dirname(filePath));
  const payload = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  fs.appendFileSync(filePath, payload, 'utf8');
}

function resolveVisualPaths(options, runContext) {
  const requested = options.visualConfig || options.visualTrace || options.visualRecord;
  if (!requested) return null;
  const baseDir = (runContext.paths && runContext.paths.debugDir)
    || (runContext.paths && runContext.paths.historyDir)
    || process.cwd();
  const defaultRecordDir = path.join(baseDir, '..', 'visual', runContext.runId);
  const traceFile = options.visualTrace
    ? (options.visualTrace === true ? path.join(defaultRecordDir, 'trace.jsonl') : path.resolve(String(options.visualTrace)))
    : null;
  const recordDir = options.visualRecord
    ? (options.visualRecord === true ? defaultRecordDir : path.resolve(String(options.visualRecord)))
    : null;
  if (recordDir) ensureDir(recordDir);
  if (traceFile) ensureDir(path.dirname(traceFile));
  return {
    enabled: true,
    traceFile,
    recordDir,
    framesEnabled: !!recordDir,
  };
}

function buildVisualHint(toolName, args) {
  return {
    toolName,
    label: toolName,
    anchor: sanitizeForRecording(args || {}),
  };
}

async function captureFrame(browser, target, visualPaths, label, visualEvents) {
  if (!visualPaths || !visualPaths.framesEnabled || !browser || !target || !target.rawId) return null;
  if (typeof browser.captureScreenshot !== 'function') return null;
  try {
    const shot = await browser.captureScreenshot(target.rawId, { format: 'jpeg', quality: 82, timeout: 15 });
    if (!shot || !shot.dataUrl) return null;
    const b64 = String(shot.dataUrl).split(',')[1] || '';
    if (!b64) return null;
    const index = visualEvents.filter((evt) => evt.type === 'frame').length + 1;
    const frameName = `frame-${String(index).padStart(3, '0')}-${label || 'step'}.jpg`;
    const framePath = path.join(visualPaths.recordDir, frameName);
    fs.writeFileSync(framePath, Buffer.from(b64, 'base64'));
    const frame = { path: framePath, width: shot.width || null, height: shot.height || null };
    visualEvents.push({ ts: Date.now(), type: 'frame', label: label || 'step', frame });
    return frame;
  } catch (_) {
    return null;
  }
}

function classifyRunBlocker(resp) {
  const code = resp && resp.error;
  if (!code) return null;
  if (code === 'captcha_required') return { category: 'captcha', recommendedAction: 'pause_and_verify' };
  if (code === 'login_required') return { category: 'auth', recommendedAction: 'reauth' };
  if (code === 'dom_navigation_required') return { category: 'navigation', recommendedAction: 'navigate_then_retry' };
  if (String(code).indexOf('dom_') === 0) return { category: 'dom', recommendedAction: 'retry_or_fallback' };
  return { category: 'unknown', recommendedAction: 'inspect_logs' };
}

function buildMetrics(result, durationMs, cacheHit) {
  const content = result && (result.content || result.excerpt || '');
  const pageInfo = result && result.pageInfo;
  return {
    status: 'success',
    durationMs,
    cacheHit,
    contentLength: String(content || '').length,
    upvoteCount: parseOptionalInt(result && result.upvote_count),
    commentCount: parseOptionalInt(result && result.comment_count),
    pageInfo: pageInfo ? {
      requestedLimit: parseOptionalInt(pageInfo.requestedLimit),
      requestedMaxPages: parseOptionalInt(pageInfo.requestedMaxPages),
      returnedCount: parseOptionalInt(pageInfo.returnedCount),
      scrollRounds: parseOptionalInt(pageInfo.scrollRounds),
      endedReason: pageInfo.endedReason || null,
      duplicateSkipped: parseOptionalInt(pageInfo.duplicateSkipped),
      blockedReason: pageInfo.blockedReason || null,
    } : null,
  };
}

function classifyAntiCrawl(resp) {
  const code = resp && resp.error;
  const blocker = classifyRunBlocker(resp);
  if (!code) return { paused: false, reason: null, category: null, recommendedAction: null };
  if (code === 'captcha_required') return { paused: true, reason: code, category: 'captcha', recommendedAction: 'pause_and_verify' };
  if (code === 'login_required') return { paused: false, reason: code, category: 'auth', recommendedAction: 'reauth' };
  return {
    paused: false,
    reason: code,
    category: blocker ? blocker.category : 'unknown',
    recommendedAction: blocker ? blocker.recommendedAction : 'inspect_logs',
  };
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
      visualConfig: options.visualConfig || null,
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
  let fallbackReason = null;
  let blocker = null;
  const visualPaths = resolveVisualPaths(options, runContext);
  const visualHint = getVisualHint(toolName, args || {});
  const visualEvents = [];
  const pushVisual = (type, payload) => {
    if (!visualPaths) return;
    visualEvents.push({ ts: Date.now(), type, payload: payload || null });
  };
  const limiter = (options.rateLimit === true || process.env.JS_ZHIHU_RATE_LIMIT === '1')
    ? getSharedLimiter(options.rateLimitOptions || {})
    : null;

  try {
    pushVisual('run_start', { toolName, pageKey, method });
    await session.connect();
    pushVisual('session_connected', { wsEndpoint: options.wsEndpoint || null });
    await session.resolveTarget();
    target = session.target;
    pushVisual('target_resolved', { url: target && target.url, tabId: target && target.rawId });
    bridgeMeta = await session.ensureBridge();
    pushVisual('bridge_ready', bridgeMeta || null);
    await captureFrame(browser, target, visualPaths, 'bridge-ready', visualEvents);

    const runCallApi = async (candidate) => {
      pushVisual('method_try', { candidate });
      const call = () => session.callApi(candidate, [args || {}], { timeoutMs: options.timeoutMs || 90000 });
      const wrapped = visualPaths
        ? () => wrapCallApi(session, visualHint, call, {
          buildSummary: (resp, hint, err) => buildSummary(resp, hint || visualHint, err),
          extractPayload: (resp, hint, err) => extractPayload(resp, hint || visualHint, err),
        })
        : call;
      return limiter ? limiter.schedule(wrapped) : wrapped();
    };

    outer: for (let i = 0; i < tryOrder.length; i++) {
      const candidate = tryOrder[i];
      triedMethods.push(candidate);
      resp = await runCallApi(candidate);
      usedMethod = candidate;
      usedMode = candidateModeLabel(candidate);

      if (resp && resp.error === 'dom_navigation_required' && resp.to) {
        pushVisual('navigation_required', { from: target && target.url, to: resp.to, candidate });
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
        pushVisual('navigation_done', { to: target && target.url, candidate });
        resp = await runCallApi(candidate);
      }

      if (resp && resp.ok) break outer;
      blocker = classifyRunBlocker(resp);
      pushVisual('method_failed', { candidate, error: resp && resp.error, blocker });
      const hasOtherPath = (i + 1) < tryOrder.length;
      if (!shouldFallBack(resp && resp.error, modeNorm, hasOtherPath)) break outer;
      fellBack = true;
      fallbackReason = resp && resp.error ? resp.error : 'unknown';
      pushVisual('fallback_triggered', { fromMethod: candidate, reason: fallbackReason });
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
    pushVisual('run_exception', { message: error.message || String(error) });
    if (visualPaths && visualPaths.traceFile) {
      try { safeJsonlAppend(visualPaths.traceFile, visualEvents); } catch (_) {}
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
    if (visualPaths) {
      try {
        const drained = await drainVisualEvents(session);
        if (Array.isArray(drained) && drained.length) visualEvents.push(...drained);
      } catch (_) {}
    }
    await captureFrame(browser, target, visualPaths, 'run-end', visualEvents);
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
    fallbackReason: fellBack ? (fallbackReason || 'unknown') : null,
    triedMethods,
    usedMethod,
    antiCrawlState: classifyAntiCrawl(resp),
    blocker,
    visual: visualPaths ? {
      enabled: true,
      hint: visualHint || buildVisualHint(toolName, args),
      events: visualEvents,
      eventsCount: visualEvents.length,
      traceFile: visualPaths.traceFile,
      recordDir: visualPaths.recordDir,
      framesEnabled: visualPaths.framesEnabled,
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

  if (visualPaths && visualPaths.traceFile) {
    try { safeJsonlAppend(visualPaths.traceFile, visualEvents); } catch (_) {}
  }
  if (visualPaths && visualPaths.recordDir) {
    try {
      safeJsonlAppend(path.join(visualPaths.recordDir, 'events.jsonl'), visualEvents);
      fs.writeFileSync(path.join(visualPaths.recordDir, 'meta.json'), JSON.stringify({
        runId: runContext.runId,
        toolName,
        pageKey,
        method,
        generatedAt: new Date().toISOString(),
        eventsCount: visualEvents.length,
      }, null, 2), 'utf8');
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
  classifyRunBlocker,
  classifyAntiCrawl,
};
