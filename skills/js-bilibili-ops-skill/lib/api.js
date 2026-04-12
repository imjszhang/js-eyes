'use strict';

const pkg = require('../package.json');
const { appendHistory, readCacheEntry, writeCacheEntry, writeDebugBundle } = require('@js-eyes/skill-recording');
const { createRunContext } = require('./runContext');
const {
  getBilibiliSubtitlesResult,
  getBilibiliVideoDetails,
} = require('./bilibiliUtils');

const SKILL_ID = pkg.name;

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function buildMetrics(scrapeResult, durationMs, cacheHit) {
  return {
    status: 'success',
    durationMs,
    cacheHit,
    ...(scrapeResult.metrics || {}),
  };
}

function buildResponse(runContext, scrapeResult, durationMs, cacheMeta = {}) {
  return {
    platform: 'bilibili',
    scrapeType: runContext.scrapeType,
    timestamp: scrapeResult.timestamp,
    sourceUrl: runContext.sourceUrl,
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
    cache_hit: options.cacheHit === true,
    cache_key: runContext.cacheKey,
    debug_bundle_path: options.debugBundlePath || '',
    error_summary: options.errorSummary || '',
    video_id: metrics.videoId || '',
    subtitle_language_count: metrics.subtitleLanguageCount ?? null,
    include_subtitles: metrics.includeSubtitles ?? null,
    fallback_used: metrics.fallbackUsed === true,
  };
}

function attachCacheHitResponse(runContext, cached, startedAtMs) {
  if (!cached?.response) {
    return null;
  }

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

async function runBilibiliOperation(url, options, config) {
  const runContext = createRunContext({
    skillId: SKILL_ID,
    scrapeType: config.scrapeType,
    skillVersion: pkg.version,
    url,
    runId: options.runId,
    recording: options.recording,
    recordingMode: options.recordingMode,
    debugRecording: options.debugRecording,
    noCache: options.noCache,
    includeSubtitles: options.includeSubtitles,
    subLangs: options.subLangs,
    noCookies: options.noCookies,
    cookiesFromBrowser: options.cookiesFromBrowser,
  });
  const startedAtMs = Date.now();
  const cached = readCacheEntry(runContext, config.cacheNamespace);
  const cachedResponse = attachCacheHitResponse(runContext, cached, startedAtMs);
  if (cachedResponse) {
    return cachedResponse;
  }

  let response = null;
  let debugBundlePath = '';

  try {
    const result = await config.runner(url, options);
    response = buildResponse(runContext, result, Date.now() - startedAtMs, { hit: false });

    const cacheEntry = writeCacheEntry(runContext, { response }, config.cacheNamespace);
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
        steps: error.debug?.steps || (error.processTrace || []).map((attempt) => ({
          timestamp: new Date().toISOString(),
          step: 'yt_dlp_attempt',
          phase: 'error',
          ...attempt,
        })),
        domStats: error.debug?.domStats || [],
        result: {
          error: error.message,
        },
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

async function getVideo(url, options = {}) {
  return runBilibiliOperation(url, options, {
    scrapeType: 'bilibili_video',
    cacheNamespace: 'video',
    runner: getBilibiliVideoDetails,
  });
}

async function getSubtitles(url, options = {}) {
  return runBilibiliOperation(url, options, {
    scrapeType: 'bilibili_subtitles',
    cacheNamespace: 'subtitles',
    runner: getBilibiliSubtitlesResult,
  });
}

module.exports = { getVideo, getSubtitles };
