'use strict';

const pkg = require('../package.json');
const { appendHistory, readCacheEntry, writeCacheEntry, writeDebugBundle } = require('@js-eyes/skill-recording');
const { createRunContext } = require('./runContext');
const { scrapeWechatArticle } = require('./wechatUtils');

const SKILL_ID = pkg.name;

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function buildMetrics(scrapeResult, durationMs, cacheHit) {
  const result = scrapeResult.data || {};
  return {
    status: 'success',
    durationMs,
    cacheHit,
    contentLength: String(result.content || '').length,
    imageCount: Array.isArray(result.image_urls) ? result.image_urls.length : 0,
    htmlLength: scrapeResult.metrics?.htmlLength ?? null,
  };
}

function buildResponse(runContext, scrapeResult, durationMs, cacheMeta = {}) {
  return {
    platform: 'wechat',
    scrapeType: 'wechat_article',
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
    cache_hit: options.cacheHit === true,
    cache_key: runContext.cacheKey,
    debug_bundle_path: options.debugBundlePath || '',
    error_summary: options.errorSummary || '',
    content_length: metrics.contentLength ?? null,
    image_count: metrics.imageCount ?? null,
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

async function getArticle(browser, url, options = {}) {
  const runContext = createRunContext({
    skillId: SKILL_ID,
    scrapeType: 'wechat_article',
    skillVersion: pkg.version,
    url,
    runId: options.runId,
    recording: options.recording,
    recordingMode: options.recordingMode,
    debugRecording: options.debugRecording,
    noCache: options.noCache,
  });
  const startedAtMs = Date.now();
  const cached = readCacheEntry(runContext, 'article');
  const cachedResponse = attachCacheHitResponse(runContext, cached, startedAtMs);
  if (cachedResponse) {
    return cachedResponse;
  }

  let response = null;
  let debugBundlePath = '';

  try {
    const result = await scrapeWechatArticle(browser, url, { runContext });
    response = buildResponse(runContext, result, Date.now() - startedAtMs, { hit: false });

    const cacheEntry = writeCacheEntry(runContext, { response }, 'article');
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

module.exports = { getArticle };
