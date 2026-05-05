'use strict';

const pkg = require('../package.json');
const { Session } = require('./session');
const {
  appendHistory,
  createSkillRunContext,
  writeDebugBundle,
} = require('@js-eyes/skill-recording');
const { sanitizeForRecording } = require('./xhsUtils');
const { getSharedLimiter } = require('./rateLimit/limiter');
const { recordCall: recordAntiCrawlCall } = require('./rateLimit/antiCrawlingStats');
// v3.1 visual 真接入：硬依赖 visual-bridge-kit（与 x-skill 一致）。
const {
  wrapCallApi,
  drainVisualEvents,
  appendVisualTrace,
  appendVisualSession,
  updateVisualSessionMeta,
  buildFrameRef,
  makeFrameWriter,
} = require('@js-eyes/visual-bridge-kit');
const { getVisualHint, buildSummary, extractPayload } = require('./visualHint');
const fs = require('fs');
const pathLib = require('path');

const SKILL_ID = pkg.name;

/**
 * auto 模式下：主路径失败且 error 命中此集合 → 尝试备路径。
 * 与 X 的 FALLBACK_TO_DOM_ERRORS 对位，但 xhs 的 auto = DOM 优先 → API 兜底，
 * 因此当 dom_* 命中这些码时，会尝试 api_*。
 */
const FALLBACK_ERRORS = new Set([
  'dom_unstable',
  'dom_timeout',
  'dom_navigation_failed',
  'dom_extract_failed',
  'dom_not_found',
  'graphql_fallback',
  'graphql_disabled',
  'all_paths_failed',
  'method_not_found',
  'bridge_not_installed',
  'bridge_returned_non_object',
  'risk_check_required',
]);

function summarizeInput(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

/**
 * v3 起 readMode 默认 'auto'，xhs 取 DOM 优先 + API 兜底（与 X 取反）。
 *  - 'auto'  → dom_* → api_*（若 dom 不支持则只跑 api_*）
 *  - 'dom'   → 仅 dom_*
 *  - 'api'   → 仅 api_*
 */
function normalizeReadMode(mode) {
  const m = String(mode || 'auto').toLowerCase();
  if (m === 'api' || m === 'graphql') return 'api';
  if (m === 'dom') return 'dom';
  return 'auto';
}

function candidateModeLabel(candidate) {
  if (String(candidate).indexOf('dom_') === 0) return 'dom';
  if (String(candidate).indexOf('api_') === 0) return 'api';
  return 'api';
}

function buildTryOrder(method, modeNorm, cmdDef) {
  if (!cmdDef || cmdDef.legacyOnly) {
    return [method];
  }
  const base = cmdDef.methodBase || method;
  const domSupported = !!cmdDef.domSupported;
  const apiSupported = cmdDef.apiSupported !== false;

  const apiMethod = `api_${base}`;
  const domMethod = `dom_${base}`;

  if (modeNorm === 'dom') {
    if (domSupported) return [domMethod];
    if (apiSupported) return [apiMethod, base];
    return [base];
  }
  if (modeNorm === 'api') {
    if (apiSupported) return [apiMethod, base];
    if (domSupported) return [domMethod];
    return [base];
  }
  // auto: DOM 优先，API 兜底
  // 调试开关：JS_XHS_DISABLE_API_FALLBACK=1 时强制只走 DOM（用于定位 API 与 DOM 模式差异）。
  const apiDisabled = process.env.JS_XHS_DISABLE_API_FALLBACK === '1';
  const order = [];
  if (domSupported) order.push(domMethod);
  if (apiSupported && !apiDisabled) order.push(apiMethod);
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

function shouldFallBack(errCode, modeNorm, hasOtherPath) {
  if (!hasOtherPath || modeNorm !== 'auto') return false;
  return FALLBACK_ERRORS.has(errCode);
}

/**
 * @param {import('./js-eyes-client').BrowserAutomation} browser
 * @param {Object} spec
 * @param {string} spec.toolName
 * @param {string} spec.pageKey  - PAGE_PROFILES key（note/search/user/home）
 * @param {string} spec.method   - bridge 方法名
 * @param {Object} [spec.cmdDef] - { methodBase, domSupported, apiSupported, legacyOnly, defaultReadMode }
 * @param {Object} [spec.args]
 * @param {string|null} [spec.targetUrl]
 * @param {Object} [spec.options]
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
  const apiSupportedHint = !!(cmdDef && cmdDef.apiSupported !== false);

  const fakeUrl = `xhs-tool://${toolName}/?args=${encodeURIComponent(JSON.stringify(args || {}))}`;
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
      // v3.0 PR-9：把会改变结果集的维度并入 cache key，避免互相污染。
      readMode: requestedReadModeRaw,
      maxCommentPages: (args && args.maxCommentPages) || 0,
      extractDetails: !!(args && args.extractDetails),
      detailsLimit: (args && args.detailsLimit) || 0,
      collectSuggest: !!(args && args.collectSuggest),
      withComments: !!(args && args.withComments),
      appliedFilters: args ? {
        channelType: args.channelType || null,
        sortBy: args.sortBy || null,
        contentType: args.contentType || null,
        timeRange: args.timeRange || null,
        searchScope: args.searchScope || null,
      } : null,
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
      reuseAnyXhsTab: options.reuseAnyXhsTab !== false,
      createUrl: options.createUrl || 'https://www.xiaohongshu.com/',
      visualConfig: options.visualConfig || null,
    },
  });

  let triedMethods = [];
  let usedMethod = null;
  let usedMode = null;
  let fellBack = false;
  let antiCrawlState = null;

  // node 侧令牌桶：仅在显式启用时生效（避免影响监控 / 单测）。
  const useLimiter = options.rateLimit === true || process.env.JS_XHS_RATE_LIMIT === '1';
  const limiter = useLimiter ? getSharedLimiter({
    minIntervalMs: options.minIntervalMs || 1500,
    maxRandomDelayMs: options.maxRandomDelayMs || 800,
    maxConcurrent: options.maxConcurrent || 2,
  }) : null;

  // visual-bridge-kit：硬依赖。当 visualConfig/trace/record 为空时只走 noop wrap（drain 仍空跑），
  // 不影响主链路；启用时 wrapCallApi 在 bridge 端 emit before/after，drain 后落 response.visual.events，
  // 并按需写 trace.jsonl + session bundle + JPEG 帧序列。
  const visualEnabled = !!(options.visualConfig || options.visualTrace || options.visualRecord);
  const hint = getVisualHint(toolName, args || {});
  // 推导 visual 输出目录：runId 维度，与 records 同级（skillDir/visual/<runId>/）。
  let visualDir = null;
  if (visualEnabled && runContext.paths && runContext.paths.skillDir) {
    visualDir = pathLib.join(runContext.paths.skillDir, 'visual', runContext.runId);
    try { fs.mkdirSync(visualDir, { recursive: true }); } catch (_) {}
  }
  // 显式传 --visual-trace=<path> / --visual-record=<dir> 时尊重；否则统一走 visualDir。
  // kit 的 parseVisualFlags 在 --visual-record（无值）时会生成 cwd/runs/sess-...，
  // 这里检测出来并重写到 visualDir，让所有 visual artifacts 集中。
  const traceFile = options.visualTrace
    ? (pathLib.isAbsolute(options.visualTrace) ? options.visualTrace : pathLib.resolve(process.cwd(), options.visualTrace))
    : (visualDir ? pathLib.join(visualDir, 'trace.jsonl') : null);
  const userPickedRecord = !!options.visualRecord && !/[\\/]runs[\\/]sess-/.test(options.visualRecord);
  const recordDir = userPickedRecord
    ? (pathLib.isAbsolute(options.visualRecord) ? options.visualRecord : pathLib.resolve(process.cwd(), options.visualRecord))
    : visualDir;
  const recordEnabled = !!options.visualRecord;
  const frameFormat = 'jpeg';
  const frameExt = 'jpg';

  // captureFrame：仅在 --visual-record 启用且 browser 支持 captureScreenshot 时配。
  // makeFrameWriter 直接把 frame 文件写在 recordDir（与 events.jsonl / meta.json 同级），
  // 不再分 frames/ 子目录（与 x-skill 一致，hyperframes 默认在同目录找）。
  let captureFrame = null;
  if (visualEnabled && recordEnabled && recordDir
      && browser && typeof browser.captureScreenshot === 'function') {
    try { fs.mkdirSync(recordDir, { recursive: true }); } catch (_) {}
    try {
      captureFrame = makeFrameWriter({
        recordDir,
        getTabId: () => (session.target && session.target.id) || null,
        captureScreenshot: async (tabId, opts) => browser.captureScreenshot(tabId, {
          format: frameFormat,
          quality: opts && opts.hiDpi ? 92 : 82,
        }),
        format: frameFormat,
        quality: 82,
        hiDpi: false,
        throttle: { maxFrames: 60, minIntervalMs: 200 },
        onWritten: async (info, meta) => {
          if (!session) return;
          const ts = meta && meta.ts;
          const frameRef = meta && meta.frameRef;
          const when = (meta && meta.when) || 'after';
          if (ts == null || !frameRef) return;
          const expr = '(window.__jse_visual && window.__jse_visual.emit && window.__jse_visual.emit({'
            + 'type:\'frame\',ts:' + ts
            + ',frameRef:' + JSON.stringify(frameRef)
            + ',when:' + JSON.stringify(when)
            + '})) || null';
          try { await session.callRaw(expr, { timeoutMs: 1500 }); } catch (_) {}
        },
        logger: options.verbose
          ? console
          : { info: () => {}, warn: (m) => process.stderr.write('[xhs-visual] ' + m + '\n'), error: (m) => process.stderr.write('[xhs-visual] ' + m + '\n') },
      });
    } catch (_) { captureFrame = null; }
  }

  const wrapHooks = {
    buildSummary: (resp, h, err) => buildSummary(resp, h || hint, err),
    extractPayload: (resp, h, err) => extractPayload(resp, h || hint, err),
  };
  if (captureFrame) {
    wrapHooks.captureFrame = captureFrame;
    wrapHooks.frameFormat = frameExt;
    wrapHooks.captureFrameTimeoutMs = 8000;
  }
  // 收集所有 drain 出来的事件，最后塞 response.visual。
  let drainedEvents = [];

  const _runCallApi = async (candidate, callArgs, callOpts) => {
    const inner = async () => session.callApi(candidate, callArgs, callOpts);
    const wrapped = visualEnabled
      ? () => wrapCallApi(session, hint, inner, wrapHooks)
      : inner;
    if (limiter) return limiter.schedule(wrapped);
    return wrapped();
  };

  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    bridgeMeta = await session.ensureBridge();

    // 进入正式 callApi 之前 drain 一次（清空 bridge 端 ring buffer 的历史事件，避免污染本次 trace）。
    if (visualEnabled) {
      try { await drainVisualEvents(session); } catch (_) {}
      // 启动 visual session bundle：写 meta.json，给 hyperframes 等下游消费。
      if (recordDir) {
        try {
          const probe = await session.callRaw(
            '(window.__jse_visual && window.__jse_visual.viewport && window.__jse_visual.viewport()) || null',
            { timeoutMs: 1500 },
          );
          const viewport = (probe && typeof probe === 'object') ? probe : null;
          updateVisualSessionMeta(recordDir, {
            skillId: SKILL_ID,
            skillVersion: pkg.version,
            toolName,
            runId: runContext.runId,
            startedAt: new Date().toISOString(),
            viewport,
            frames: captureFrame ? {
              enabled: true,
              format: frameFormat,
              quality: 82,
              hiDpi: false,
              maxFrames: 60,
            } : { enabled: false },
            hint,
          });
        } catch (_) {}
      }
    }

    // 登录态预检：评论 API 必须有 web_session，否则直接短路返回 login_required。
    // 触发条件：工具是 xhs_get_note_comments（method=getComments）或 args.withComments===true。
    const needsLogin = method === 'getComments' || (args && args.withComments === true);
    if (needsLogin) {
      let sessResp = null;
      try { sessResp = await session.callApi('sessionState'); } catch (_) { sessResp = null; }
      const cookieFlags = sessResp && sessResp.ok && sessResp.data && sessResp.data.cookieFlags;
      if (cookieFlags && cookieFlags.hasWebSession === false) {
        const skipResult = {
          ok: false,
          error: 'login_required',
          reason: 'web_session_missing',
          hint: '评论 API 必须有登录态。请在浏览器登录小红书后重试，或运行 `xhs login` 引导登录。',
          loginUrl: 'https://www.xiaohongshu.com/login',
          cookieFlags,
        };
        triedMethods = [];
        usedMethod = null;
        resp = skipResult;
        // 跳过尝试循环，直接走结果归一化
      }
    }

    outer: for (let i = 0; i < tryOrder.length && !(resp && resp.error === 'login_required'); i++) {
      const candidate = tryOrder[i];
      triedMethods.push(candidate);

      let navAttempts = 0;
      const navHistory = [];

      inner: while (true) {
        resp = await _runCallApi(candidate, [args || {}], {
          timeoutMs: options.timeoutMs || 90000,
        });
        usedMethod = candidate;
        usedMode = candidateModeLabel(candidate);

        // bridge 端可能在响应里附带反爬状态
        if (resp && resp.antiCrawlState) {
          antiCrawlState = resp.antiCrawlState;
        }

        if (resp && resp.ok) break inner;

        const toUrl = resp && resp.to ? String(resp.to) : '';
        if (
          resp && resp.error === 'dom_navigation_required'
          && (resp.navMethod || toUrl)
          && toUrl && navAttempts < 2 && navHistory.indexOf(toUrl) === -1
        ) {
          navAttempts += 1;
          navHistory.push(toUrl);
          const navMethod = resp.navMethod || null;
          const navArgs = resp.navArgs || {};
          const fromUrl = target && target.url ? target.url : null;
          if (navMethod) {
            try {
              await session.callApi(navMethod, [navArgs], { timeoutMs: 12000 });
            } catch (_) {}
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
          continue inner;
        }
        break inner;
      }

      if (resp && resp.ok) break outer;
      if (i === tryOrder.length - 1) break outer;

      const errCode = resp && resp.error;
      const hasOtherPath = (i + 1) < tryOrder.length;
      if (!shouldFallBack(errCode, modeNorm, hasOtherPath)) break outer;

      fellBack = true;
    }

    // 成功路径 drain：把 wrapCallApi 期间 bridge ring buffer 的事件捞出来。
    if (visualEnabled) {
      try {
        const tail = await drainVisualEvents(session);
        if (Array.isArray(tail) && tail.length) drainedEvents = drainedEvents.concat(tail);
      } catch (_) {}
    }
  } catch (error) {
    // 异常路径也尝试 drain，避免 bridge 状态残留。
    if (visualEnabled) {
      try {
        const tail = await drainVisualEvents(session);
        if (Array.isArray(tail) && tail.length) drainedEvents = drainedEvents.concat(tail);
      } catch (_) {}
    }
    const durationMs = Date.now() - startedAt;
    if (runContext.recording.debugEnabled) {
      try {
        debugBundlePath = writeDebugBundle(runContext, {
          meta: {
            runId: runContext.runId,
            skillId: runContext.skillId,
            scrapeType: toolName,
            sourceUrl: fakeUrl,
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
  const response = {
    platform: 'xiaohongshu',
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
      paths: runContext.paths ? {
        historyDir: runContext.paths.historyDir,
        cacheDir: runContext.paths.cacheDir,
        debugDir: runContext.paths.debugDir,
        historyFile: runContext.paths.historyDir
          ? require('path').join(runContext.paths.historyDir, new Date().toISOString().slice(0, 7) + '.jsonl')
          : null,
      } : null,
    },
    bridge: bridgeMeta,
    ok,
    readMode: usedMode,
    requestedReadMode: requestedReadModeRaw,
    fallback: fellBack,
    triedMethods,
    usedMethod,
    antiCrawlState: antiCrawlState || null,
    visual: visualEnabled ? {
      enabled: true,
      hint,
      events: drainedEvents,
      eventsCount: drainedEvents.length,
      traceFile: traceFile || null,
      recordDir: recordDir || null,
      framesEnabled: !!captureFrame,
    } : null,
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

  // visual 落盘：trace JSONL（单文件）+ session bundle events.jsonl + meta 更新。
  // 落盘：appendVisualTrace / appendVisualSession 都是「单条 entry」接口，需要循环。
  if (visualEnabled && drainedEvents.length > 0) {
    if (traceFile) {
      for (const ev of drainedEvents) {
        try { appendVisualTrace(traceFile, ev); } catch (_) {}
      }
    }
    if (recordDir) {
      for (const ev of drainedEvents) {
        try { appendVisualSession(recordDir, ev); } catch (_) {}
      }
    }
  }
  if (visualEnabled && recordDir) {
    try {
      updateVisualSessionMeta(recordDir, {
        finishedAt: new Date().toISOString(),
        durationMs,
        ok,
        eventsCount: drainedEvents.length,
        antiCrawlState: antiCrawlState || null,
      });
    } catch (_) {}
  }

  // 反爬统计落盘（best-effort）
  try {
    if (options.recordAntiCrawl !== false) {
      recordAntiCrawlCall({
        toolName,
        antiCrawlState,
        reason: ok ? 'ok' : ((response.error && response.error.code) || 'unknown'),
      });
    }
  } catch (_) {}

  return response;
}

module.exports = {
  runTool,
  buildTryOrder,
  normalizeReadMode,
  FALLBACK_ERRORS,
};
