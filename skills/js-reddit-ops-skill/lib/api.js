'use strict';

const pkg = require('../package.json');
const { scrapeRedditPost } = require('./redditUtils');
const { createRunContext } = require('./runContext');
const { appendHistory } = require('./history');
const { readCacheEntry, writeCacheEntry } = require('./cache');
const { writeDebugBundle } = require('./debug');

const SKILL_ID = pkg.name;

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
    const result = await scrapeRedditPost(browser, url, { runContext });
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

module.exports = { getPost };
