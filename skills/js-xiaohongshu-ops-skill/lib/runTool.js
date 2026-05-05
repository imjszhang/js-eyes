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

// 可选 visual-bridge-kit 依赖：缺包时降级到 noop。
let _visualKit = null;
function _loadVisualKit() {
  if (_visualKit !== null) return _visualKit;
  try {
    _visualKit = require('@js-eyes/visual-bridge-kit');
  } catch (_) {
    _visualKit = false;
  }
  return _visualKit;
}

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

  // visual-bridge-kit：可选，仅在传入 visualConfig / visualTrace / visualRecord 时启用。
  const visualKit = (options.visualConfig || options.visualTrace || options.visualRecord) ? _loadVisualKit() : false;
  const _wrapCall = async (fn) => {
    if (!visualKit || !visualKit.wrapCallApi) return fn();
    try { return await visualKit.wrapCallApi(session, null, fn, {}); }
    catch (_) { return fn(); }
  };

  const _runCallApi = async (candidate, callArgs, callOpts) => {
    const inner = () => session.callApi(candidate, callArgs, callOpts);
    if (limiter) return limiter.schedule(() => _wrapCall(inner));
    return _wrapCall(inner);
  };

  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    bridgeMeta = await session.ensureBridge();

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
