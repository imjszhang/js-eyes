'use strict';

const path = require('path');
const pkg = require('../package.json');
const { Session } = require('./session');
const {
  appendHistory,
  createSkillRunContext,
  writeDebugBundle,
} = require('@js-eyes/skill-recording');
const {
  wrapCallApi,
  drainVisualEvents,
  appendVisualTrace,
  appendVisualSession,
  updateVisualSessionMeta,
  makeFrameWriter,
  buildFrameRef,
} = require('@js-eyes/visual-bridge-kit');
const { getVisualHint, buildSummary, extractPayload } = require('./visualHint');

const SKILL_ID = pkg.name;

/**
 * auto 模式下：GraphQL(api_*) 失败且 error 命中此集合 → 尝试 dom_*。
 * 亦包含 Reddit 对齐的 DOM 不稳定码，便于未来 dom-first 分支复用。
 */
const FALLBACK_TO_DOM_ERRORS = new Set([
  'graphql_fallback',
  'graphql_discovery_failed',
  'graphql_disabled',
  'graphql_discover_failed',
  'all_paths_failed',
  'dom_unstable',
  'dom_timeout',
  'dom_navigation_failed',
  'dom_extract_failed',
  'dom_not_found',
  'method_not_found',
  'bridge_not_installed',
  'bridge_returned_non_object',
]);

function summarizeInput(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

// 接收 runTool 的 readMode（v3.2 前叫 mode；与 visual-bridge-kit 的 hud/flash 完全无关）。
function normalizeReadMode(mode) {
  const m = String(mode || 'auto').toLowerCase();
  if (m === 'api' || m === 'graphql') return 'graphql';
  if (m === 'dom') return 'dom';
  return 'auto';
}

function candidateModeLabel(candidate) {
  if (String(candidate).indexOf('dom_') === 0) return 'dom';
  if (String(candidate).indexOf('api_') === 0) return 'graphql';
  return 'graphql';
}

function buildTryOrder(method, modeNorm, cmdDef) {
  if (!cmdDef || cmdDef.legacyOnly) {
    return [method];
  }
  const base = cmdDef.methodBase || method;
  const domSupported = !!cmdDef.domSupported;
  const apiSupported = cmdDef.apiSupported !== false;

  const graphqlMethod = `api_${base}`;
  const domMethod = `dom_${base}`;

  if (modeNorm === 'dom') {
    if (domSupported) return [domMethod];
    if (apiSupported) return [graphqlMethod, base];
    return [base];
  }
  if (modeNorm === 'graphql') {
    if (apiSupported) return [graphqlMethod, base];
    if (domSupported) return [domMethod];
    return [base];
  }
  const order = [];
  if (apiSupported) order.push(graphqlMethod);
  if (domSupported) order.push(domMethod);
  if (order.length === 0) return [base];
  const dedup = [];
  const seen = new Set();
  for (const c of order) {
    if (seen.has(c)) continue;
    seen.add(c);
    dedup.push(c);
  }
  return dedup;
}

function shouldFallBackToDom(errCode, modeNorm, domSupported) {
  if (!domSupported || modeNorm !== 'auto') return false;
  return FALLBACK_TO_DOM_ERRORS.has(errCode);
}

/**
 * @param {import('./js-eyes-client').BrowserAutomation} browser
 * @param {Object} spec
 * @param {Object} [spec.cmdDef]
 * @param {string} [spec.cmdDef.methodBase]
 * @param {boolean} [spec.cmdDef.domSupported]
 * @param {boolean} [spec.cmdDef.apiSupported]
 * @param {boolean} [spec.cmdDef.legacyOnly]
 */
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

  const requestedReadModeRaw = options.readMode || (cmdDef && cmdDef.defaultReadMode) || 'auto';
  const modeNorm = normalizeReadMode(requestedReadModeRaw);
  const tryOrder = buildTryOrder(method, modeNorm, cmdDef);
  const domSupportedHint = !!(cmdDef && cmdDef.domSupported);

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
      visualConfig: options.visualConfig || null,
    },
  });

  const hint = getVisualHint(toolName, args);
  let drainedEvents = [];
  let triedMethods = [];
  let usedMethod = null;
  let usedMode = null;
  let fellBack = false;

  const recordDir = options.visualRecord ? path.resolve(options.visualRecord) : null;
  const framesEnabled = !!recordDir && options.noFrames !== true && typeof browser.captureScreenshot === 'function';
  const hiDpi = !!options.hiDpi;
  const maxFrames = Number.isFinite(options.maxFrames) ? options.maxFrames : 80;
  const frameFormat = 'jpg';
  const captureScreenshotForKit = framesEnabled
    ? async (tabId, opts) => browser.captureScreenshot(tabId, {
        format: 'jpeg',
        quality: opts && opts.hiDpi ? 92 : 82,
      })
    : null;
  const captureFrame = framesEnabled ? makeFrameWriter({
    recordDir,
    getTabId: () => (session.target && session.target.id) || null,
    captureScreenshot: captureScreenshotForKit,
    format: 'jpeg',
    quality: hiDpi ? 92 : 82,
    hiDpi,
    throttle: { maxFrames, minIntervalMs: 200 },
    onWritten: async (info, meta) => {
      if (!session) return;
      let viewport = null;
      try {
        const probe = await session.callRaw(
          '(window.__jse_visual && window.__jse_visual.viewport()) || null',
          { timeoutMs: 1500 },
        );
        if (probe && typeof probe === 'object') viewport = probe;
      } catch (_) {}
      const ts = meta.ts;
      const frameRef = meta.frameRef;
      const when = meta.when || 'after';
      const expr = '(window.__jse_visual && window.__jse_visual.emit({'
        + `type:'frame',ts:${ts},frameRef:${JSON.stringify(frameRef)},`
        + `when:${JSON.stringify(when)},`
        + `viewport:${JSON.stringify(viewport)}`
        + '})) || null';
      try { await session.callRaw(expr, { timeoutMs: 1500 }); } catch (_) {}
    },
    logger: console,
  }) : null;

  async function shootFrame(when) {
    if (!captureFrame) return;
    try {
      const ts = Date.now();
      const info = { ts, when, frameRef: buildFrameRef(ts, frameFormat) };
      const r = captureFrame(info);
      if (r && typeof r.then === 'function') await r;
    } catch (_) {}
  }

  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    bridgeMeta = await session.ensureBridge();

    try {
      await session.callRaw(
        '(window.__jse_visual && window.__jse_visual.drainEvents()) || []',
        { timeoutMs: 1500 },
      );
    } catch (_) {}

    if (recordDir) {
      try {
        const probe = await session.callRaw(
          '(window.__jse_visual && window.__jse_visual.viewport()) || null',
          { timeoutMs: 1500 },
        );
        const viewport = (probe && typeof probe === 'object') ? probe : null;
        updateVisualSessionMeta(recordDir, {
          viewport,
          frames: framesEnabled ? {
            enabled: true,
            format: 'jpeg',
            quality: hiDpi ? 92 : 82,
            hiDpi,
            maxFrames,
          } : { enabled: false },
        });
      } catch (_) {}
    }

    const wrapHooks = {
      buildSummary: (r) => buildSummary(r, hint),
      extractPayload: (r, h, e) => extractPayload(r, Object.assign({}, hint, { args }), e),
    };
    if (captureFrame) {
      wrapHooks.captureFrame = captureFrame;
      wrapHooks.frameFormat = frameFormat;
      wrapHooks.captureFrameTimeoutMs = 3000;
    }

    outer: for (let i = 0; i < tryOrder.length; i++) {
      const candidate = tryOrder[i];
      triedMethods.push(candidate);

      let navAttempts = 0;
      const navHistory = [];

      inner: while (true) {
        resp = await wrapCallApi(session, hint, async () => {
          return await session.callApi(candidate, [args || {}], {
            timeoutMs: options.timeoutMs || 90000,
          });
        }, wrapHooks);
        usedMethod = candidate;
        usedMode = candidateModeLabel(candidate);
        if (resp && resp.ok) break inner;

        const toUrl = resp && resp.to ? String(resp.to) : '';
        // api_* 与 dom_* 均可能在「当前 tab URL 不匹配」时返回 dom_navigation_required
        //（例如 api_search / dom_search 在 /home），需同源 navigate 后再调同一候选。
        if (
          resp && resp.error === 'dom_navigation_required'
          && (resp.navMethod || toUrl)
          && toUrl && navAttempts < 2 && navHistory.indexOf(toUrl) === -1
        ) {
          navAttempts += 1;
          navHistory.push(toUrl);
          await shootFrame('pre-nav');
          try {
            const pre = await drainVisualEvents(session);
            if (Array.isArray(pre) && pre.length) drainedEvents = drainedEvents.concat(pre);
          } catch (_) {}
          const navMethod = resp.navMethod || null;
          const navArgs = resp.navArgs || {};
          const fromUrl = target && target.url ? target.url : null;
          if (navMethod) {
            try {
              await session.callApi(navMethod, [navArgs], { timeoutMs: 12000 });
            } catch (_) { /* navigation 中断 */ }
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
          await shootFrame('post-nav');
          continue inner;
        }
        break inner;
      }

      if (resp && resp.ok) break outer;

      if (i === tryOrder.length - 1) break outer;

      const errCode = resp && resp.error;
      if (!shouldFallBackToDom(errCode, modeNorm, domSupportedHint)) break outer;

      fellBack = true;
    }

    try {
      const tail = await drainVisualEvents(session);
      if (Array.isArray(tail) && tail.length) drainedEvents = drainedEvents.concat(tail);
    } catch (_) {}
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    try {
      const tail = await drainVisualEvents(session);
      if (Array.isArray(tail) && tail.length) drainedEvents = drainedEvents.concat(tail);
    } catch (_) {}
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
    readMode: usedMode,
    requestedReadMode: requestedReadModeRaw,
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

module.exports = {
  runTool,
  buildTryOrder,
  normalizeReadMode,
  FALLBACK_TO_DOM_ERRORS,
};
