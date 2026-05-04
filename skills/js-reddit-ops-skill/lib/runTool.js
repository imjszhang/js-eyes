'use strict';

const path = require('path');
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
  updateVisualSessionMeta,
  makeFrameWriter,
  buildFrameRef,
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

  const requestedReadMode = options.readMode
    || (cmdDef && cmdDef.defaultReadMode)
    || 'auto';
  const tryOrder = buildTryOrder(method, requestedReadMode, cmdDef);

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

  // v0.5.0 snapshot mode: 当 visualRecord 启用时，构建 captureFrame 写盘 hook。
  //   - 每条命令 wrapCallApi after 截一帧（fire-and-forget 但 await 到 onWritten）
  //   - dom_navigation_required retry 跳页前 / 跳页后各额外触发一帧
  //   - onWritten 回写 frame 事件到 bridge ring buffer，drainVisualEvents 自然取回
  //   - --no-frames opt-out / --hi-dpi opt-in / --max-frames 覆盖默认 80
  const recordDir = options.visualRecord ? path.resolve(options.visualRecord) : null;
  const framesEnabled = !!recordDir && options.noFrames !== true;
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

  try {
    await session.connect();
    await session.resolveTarget();
    target = session.target;
    bridgeMeta = await session.ensureBridge();

    // v0.5.0/v3.8.1：bridge 注入完成后，先把 ring buffer 里残留的过期事件清掉。
    // 否则上一次 skill 调用留下来的 hud / flash / dom_* 事件会被这次 drainVisualEvents
    // 一起拉走，混进 events.jsonl 第一批；过期事件 ts 比本次 session 早几分钟，
    // buildTimeline 又用 firstEventTs 当 t=0，会把整条 timeline 推后到几百秒之后，
    // hyperframes 打开就是一张死图。
    try {
      await session.callRaw(
        '(window.__jse_visual && window.__jse_visual.drainEvents()) || []',
        { timeoutMs: 1500 },
      );
    } catch (_) {}

    // v0.5.0: ensureBridge 后探一次视口尺寸写到 meta.json，translator 据此设置
    // #stage aspect-ratio + 单位换算。
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

    // v0.5.0：主链路同时挂 buildSummary + extractPayload + captureFrame。
    // v3.7.0 dom-first：按 tryOrder 依次尝试，失败且属于 FALLBACK_ERRORS 时回退下一个候选；
    // 内层处理 'dom_navigation_required'：bridge 主动报需要先导航，runTool 借现有 api 路径
    // location.assign + awaitBridgeAfterNav + ensureBridge 后重试同一 candidate（最多一次）。
    const wrapHooks = {
      buildSummary: (r) => buildSummary(r, hint),
      extractPayload: (r, h, e) => extractPayload(r, Object.assign({}, hint, { args }), e),
    };
    if (captureFrame) {
      wrapHooks.captureFrame = captureFrame;
      wrapHooks.frameFormat = frameFormat;
      wrapHooks.captureFrameTimeoutMs = 3000;
    }

    // 在 dom_navigation_required retry 前后手动触发一帧（绕开 wrapCallApi）
    async function shootFrame(when) {
      if (!captureFrame) return;
      try {
        const ts = Date.now();
        const info = { ts, when, frameRef: buildFrameRef(ts, frameFormat) };
        const r = captureFrame(info);
        if (r && typeof r.then === 'function') await r;
      } catch (_) {}
    }

    for (let i = 0; i < tryOrder.length; i++) {
      const candidate = tryOrder[i];
      triedMethods.push(candidate);

      let navAttempts = 0;
      // v3.8.1：放宽 navAttempts 上限到 2。原来固定 1 次只能覆盖 "fromPath 不匹配"
      // 单一场景。新的 user-bridge 可能链式触发 nav：
      //   step1：fromPath.name 不匹配 → nav 到正确 user
      //   step2：着陆页是 reddit 自家废弃路径的 404 → bridge 报 page_404 nav 到默认 url
      // 必须 2 次才能稳定收敛。每个 to URL 不同时才算独立配额，避免 nav 死循环。
      const navHistory = [];
      while (true) {
        resp = await wrapCallApi(session, hint, async () => {
          return await session.callApi(candidate, [args || {}], {
            timeoutMs: options.timeoutMs || 90000,
          });
        }, wrapHooks);
        usedMethod = candidate;
        usedMode = candidate.startsWith('dom_') ? 'dom' : 'api';
        if (resp && resp.ok) break;
        const toUrl = resp && resp.to ? String(resp.to) : '';
        if (
          candidate.indexOf('dom_') === 0 &&
          resp && resp.error === 'dom_navigation_required' &&
          toUrl && navAttempts < 2 && navHistory.indexOf(toUrl) === -1
        ) {
          navAttempts += 1;
          navHistory.push(toUrl);
          await shootFrame('pre-nav');
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
          await shootFrame('post-nav');
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
    readMode: usedMode,
    requestedReadMode,
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
