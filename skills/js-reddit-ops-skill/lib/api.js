'use strict';

const pkg = require('../package.json');
const { scrapeRedditPost } = require('./redditUtils');
const { scrapeViaBridge } = require('./bridgeAdapter');
const { createRunContext } = require('./runContext');
const { appendHistory } = require('./history');
const { readCacheEntry, writeCacheEntry } = require('./cache');
const { writeDebugBundle } = require('./debug');

const SKILL_ID = pkg.name;

const FALLBACK_REASON = {
  DISABLED_BY_ENV: 'bridge_disabled_by_env',
  RETURN_NOT_OK: 'bridge_returned_error',
  INJECT_FAILED: 'bridge_inject_failed',
  CORRUPT: 'bridge_corrupt',
  NO_TAB: 'bridge_no_target_tab',
  BAD_ARG: 'bridge_bad_arg',
  CALL_FAILED: 'bridge_call_failed',
};

function classifyBridgeError(err) {
  if (!err) return FALLBACK_REASON.CALL_FAILED;
  switch (err.code) {
    case 'BRIDGE_RETURN_NOT_OK': return FALLBACK_REASON.RETURN_NOT_OK;
    case 'E_BRIDGE_INSTALL': return FALLBACK_REASON.INJECT_FAILED;
    case 'E_BRIDGE_CORRUPT': return FALLBACK_REASON.CORRUPT;
    case 'E_NO_TAB': return FALLBACK_REASON.NO_TAB;
    case 'E_BAD_ARG': return FALLBACK_REASON.BAD_ARG;
    default: return FALLBACK_REASON.CALL_FAILED;
  }
}

/**
 * scrapePost - 主路径走 bridge JSON API；失败时 fallback 到 cheerio DOM 实现，
 * 保证字段级与旧版（v2.x）输出一致。
 *
 * 旁路开关（仅 CLI / 调试用，不暴露给 AI）：
 * - JS_REDDIT_DISABLE_BRIDGE=1   直接走 DOM 兜底
 * - JS_REDDIT_DISABLE_FALLBACK=1 bridge 失败直接抛错（用于 schema diff / 排查）
 *
 * metrics 里的 bridgeFallbackReason 是稳定枚举（见 FALLBACK_REASON），
 * bridgeFallbackMessage 才是原始错误文本，方便上层做监控聚合。
 */
async function scrapePost(browser, url, options = {}) {
  const disabledByEnv = process.env.JS_REDDIT_DISABLE_BRIDGE === '1';
  const useBridge = options.useBridge !== false && !disabledByEnv;
  if (!useBridge) {
    const result = await scrapeRedditPost(browser, url, options);
    result.metrics = result.metrics || {};
    result.metrics.bridgeUsed = false;
    result.metrics.bridgeFallback = false;
    if (disabledByEnv) {
      result.metrics.bridgeFallback = true;
      result.metrics.bridgeFallbackReason = FALLBACK_REASON.DISABLED_BY_ENV;
      result.metrics.bridgeFallbackMessage = 'JS_REDDIT_DISABLE_BRIDGE=1';
      result.metrics.bridgeFallbackCode = null;
    }
    return result;
  }
  try {
    const result = await scrapeViaBridge(browser, url, {
      depth: options.depth,
      limit: options.limit,
      sort: options.sort,
      verbose: options.verbose,
      timeoutMs: options.bridgeTimeoutMs,
    });
    result.metrics = result.metrics || {};
    result.metrics.bridgeUsed = true;
    result.metrics.bridgeFallback = false;
    return result;
  } catch (bridgeError) {
    if (process.env.JS_REDDIT_DISABLE_FALLBACK === '1') throw bridgeError;
    const fallback = await scrapeRedditPost(browser, url, options);
    fallback.metrics = fallback.metrics || {};
    fallback.metrics.bridgeUsed = false;
    fallback.metrics.bridgeFallback = true;
    fallback.metrics.bridgeFallbackReason = classifyBridgeError(bridgeError);
    fallback.metrics.bridgeFallbackMessage = bridgeError.message || String(bridgeError);
    fallback.metrics.bridgeFallbackCode = bridgeError.code || null;
    return fallback;
  }
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function countComments(items = []) {
  return items.reduce((total, item) => total + 1 + countComments(item.replies || []), 0);
}

function parseOptionalInt(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function buildMetrics(scrapeResult, durationMs, cacheHit) {
  const comments = scrapeResult.data.comments || [];
  const declaredCommentCount = parseOptionalInt(scrapeResult.data.comment_count);
  const parsedTopLevelCount = comments.length;
  const parsedTotalCount = countComments(comments);
  const beforePrepare = scrapeResult.metrics?.beforePrepare || null;
  const afterPrepare = scrapeResult.metrics?.afterPrepare || null;
  const coverageRatio = declaredCommentCount && declaredCommentCount > 0
    ? Number((parsedTotalCount / declaredCommentCount).toFixed(4))
    : null;

  return {
    status: declaredCommentCount !== null && parsedTotalCount < declaredCommentCount ? 'partial' : 'success',
    durationMs,
    cacheHit,
    declaredCommentCount,
    parsedTopLevelCount,
    parsedTotalCount,
    coverageRatio,
    collapsedCountBefore: beforePrepare?.collapsedCount ?? null,
    collapsedCountAfter: afterPrepare?.collapsedCount ?? null,
    moreRepliesCountBefore: beforePrepare?.moreRepliesCount ?? null,
    moreRepliesCountAfter: afterPrepare?.moreRepliesCount ?? null,
    bridgeUsed: scrapeResult.metrics?.bridgeUsed === true,
    bridgeFallback: scrapeResult.metrics?.bridgeFallback === true,
    bridgeFallbackReason: scrapeResult.metrics?.bridgeFallbackReason || null,
    bridgeFallbackMessage: scrapeResult.metrics?.bridgeFallbackMessage || null,
    bridgeFallbackCode: scrapeResult.metrics?.bridgeFallbackCode || null,
    bridge: scrapeResult.metrics?.bridge || null,
  };
}

function buildResponse(runContext, scrapeResult, durationMs, cacheMeta = {}) {
  return {
    platform: 'reddit',
    scrapeType: 'reddit_post',
    timestamp: scrapeResult.timestamp,
    sourceUrl: scrapeResult.sourceUrl,
    run: {
      id: runContext.runId,
      cacheHit: cacheMeta.hit === true,
      recordingMode: runContext.recording.mode,
    },
    cache: {
      hit: cacheMeta.hit === true,
      key: runContext.cacheKey,
      createdAt: cacheMeta.createdAt || null,
      expiresAt: cacheMeta.expiresAt || null,
    },
    metrics: buildMetrics(scrapeResult, durationMs, cacheMeta.hit === true),
    result: scrapeResult.data,
  };
}

function buildHistoryEntry(runContext, response, options = {}) {
  const metrics = response?.metrics || {};
  return {
    run_id: runContext.runId,
    skill_id: runContext.skillId,
    tool_name: runContext.scrapeType,
    timestamp: new Date().toISOString(),
    input_url: runContext.sourceUrl,
    normalized_url: runContext.normalizedUrl,
    status: options.status || metrics.status || 'success',
    duration_ms: options.durationMs,
    declared_comment_count: metrics.declaredCommentCount ?? null,
    parsed_top_level_count: metrics.parsedTopLevelCount ?? null,
    parsed_total_count: metrics.parsedTotalCount ?? null,
    collapsed_count_before: metrics.collapsedCountBefore ?? null,
    collapsed_count_after: metrics.collapsedCountAfter ?? null,
    more_replies_count_before: metrics.moreRepliesCountBefore ?? null,
    more_replies_count_after: metrics.moreRepliesCountAfter ?? null,
    cache_hit: options.cacheHit === true,
    cache_key: runContext.cacheKey,
    debug_bundle_path: options.debugBundlePath || '',
    error_summary: options.errorSummary || '',
  };
}

async function getPost(browser, url, options = {}) {
  const runContext = createRunContext({
    skillId: SKILL_ID,
    scrapeType: 'reddit_post',
    skillVersion: pkg.version,
    url,
    runId: options.runId,
    recording: options.recording,
    recordingMode: options.recordingMode,
    debugRecording: options.debugRecording,
    noCache: options.noCache,
  });
  const startedAtMs = Date.now();

  const cached = readCacheEntry(runContext, 'post');
  if (cached && cached.response) {
    const cacheDurationMs = Date.now() - startedAtMs;
    const response = clone(cached.response);
    response.run = {
      id: runContext.runId,
      cacheHit: true,
      recordingMode: runContext.recording.mode,
    };
    response.cache = {
      hit: true,
      key: runContext.cacheKey,
      createdAt: cached.createdAt || null,
      expiresAt: cached.expiresAt || null,
    };
    if (response.metrics) {
      response.metrics.cacheHit = true;
      response.metrics.durationMs = cacheDurationMs;
    }
    appendHistory(runContext, buildHistoryEntry(runContext, response, {
      durationMs: cacheDurationMs,
      cacheHit: true,
    }));
    return response;
  }

  let response = null;
  let debugBundlePath = '';

  try {
    const result = await scrapePost(browser, url, {
      runContext,
      depth: options.depth,
      limit: options.limit,
      sort: options.sort,
      verbose: options.verbose,
      bridgeTimeoutMs: options.bridgeTimeoutMs,
      useBridge: options.useBridge,
    });
    response = buildResponse(runContext, result, Date.now() - startedAtMs, { hit: false });

    const cacheEntry = writeCacheEntry(runContext, { response }, 'post');
    if (cacheEntry) {
      response.cache.createdAt = cacheEntry.createdAt;
      response.cache.expiresAt = cacheEntry.expiresAt;
    }

    if (runContext.recording.debugEnabled) {
      debugBundlePath = writeDebugBundle(runContext, {
        meta: {
          runId: runContext.runId,
          skillId: runContext.skillId,
          scrapeType: runContext.scrapeType,
          sourceUrl: runContext.sourceUrl,
          normalizedUrl: runContext.normalizedUrl,
          recordingMode: runContext.recording.mode,
          cacheKey: runContext.cacheKey,
          metrics: response.metrics,
        },
        steps: result.debug?.steps || [],
        domStats: result.debug?.domStats || [],
        result: response,
        rawHtml: result.debug?.rawHtml,
      }) || '';
      response.debug = { bundlePath: debugBundlePath };
    }

    appendHistory(runContext, buildHistoryEntry(runContext, response, {
      durationMs: response.metrics.durationMs,
      cacheHit: false,
      debugBundlePath,
    }));
    return response;
  } catch (error) {
    if (runContext.recording.debugEnabled) {
      debugBundlePath = writeDebugBundle(runContext, {
        meta: {
          runId: runContext.runId,
          skillId: runContext.skillId,
          scrapeType: runContext.scrapeType,
          sourceUrl: runContext.sourceUrl,
          normalizedUrl: runContext.normalizedUrl,
          recordingMode: runContext.recording.mode,
          cacheKey: runContext.cacheKey,
          error: error.message,
        },
        steps: error.debug?.steps || [],
        domStats: error.debug?.domStats || [],
        result: {
          error: error.message,
        },
        rawHtml: error.debug?.rawHtml,
      }) || '';
    }

    appendHistory(runContext, buildHistoryEntry(runContext, response, {
      status: 'failed',
      durationMs: Date.now() - startedAtMs,
      cacheHit: false,
      debugBundlePath,
      errorSummary: error.message,
    }));
    throw error;
  }
}

module.exports = { getPost, scrapePost, FALLBACK_REASON };
