'use strict';

function createMethods(dependencies = {}) {
  const { SKILL_ID, appendHistory, createSkillRunContext, pkg, recordStep, waitForPageLoad } = dependencies;

function noop() {}

function makeLog(logger) {
    if (!logger) return { log: noop, warn: noop, error: noop };
    return {
        log:   logger.log   || logger.info || noop,
        warn:  logger.warn  || noop,
        error: logger.error || noop,
    };
}

async function openAndWait(browser, tabId, url, safeExec, log) {
    try {
        await safeExec(tabId, 'performance.clearResourceTimings(); void 0;', { timeout: 5 });
        await browser.openUrl(url, tabId);
        try { await waitForPageLoad(browser, tabId, { timeout: 30000 }); } catch (_) {}
        await new Promise(r => setTimeout(r, 4000));
    } catch (e) {
        log.warn(`⚠ 页面刷新失败: ${e.message}`);
    }
}

function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : value;
}

function summarizeInput(value) {
    try {
        return JSON.stringify(value);
    } catch (_) {
        return String(value);
    }
}

function createRecordingLogger(logger, debugState) {
    const base = makeLog(logger);
    const createForwarder = (level) => (...args) => {
        const message = args.map((value) => String(value)).join(' ');
        recordStep(debugState, 'log', { level, message });
        base[level](...args);
    };

    return {
        log: createForwarder('log'),
        warn: createForwarder('warn'),
        error: createForwarder('error'),
    };
}

function createXRunContext(scrapeType, input, options = {}) {
    return createSkillRunContext({
        skillId: SKILL_ID,
        toolName: scrapeType,
        scrapeType,
        skillVersion: pkg.version,
        input,
        recording: options.recording,
        recordingMode: options.recordingMode,
        debugRecording: options.debugRecording,
        noCache: options.noCache,
        normalizeInput: (value) => value,
        buildCacheKeyParts: ({ skillId, toolName, normalizedInput, skillVersion }) => ({
            skillId,
            toolName,
            input: normalizedInput,
            version: skillVersion,
        }),
    });
}

function buildXMetrics(scrapeType, result, durationMs, cacheHit) {
    const route = result && result._bridgeRoute ? result._bridgeRoute : {};
    const bridgeFields = {
        bridgeUsed: route.bridgeUsed === true,
        bridgeFallback: route.bridgeFallback === true,
        bridgeFallbackReason: route.bridgeFallbackReason || null,
        bridgeFallbackMessage: route.bridgeFallbackMessage || null,
        bridgeFallbackCode: route.bridgeFallbackCode || null,
        bridgeVersion: route.bridgeVersion || null,
    };

    if (scrapeType === 'x_post') {
        return {
            status: result.totalFailed > 0 ? 'partial' : 'success',
            durationMs,
            cacheHit,
            totalRequested: result.totalRequested ?? 0,
            totalSuccess: result.totalSuccess ?? 0,
            totalFailed: result.totalFailed ?? 0,
            ...bridgeFields,
        };
    }

    return {
        status: 'success',
        durationMs,
        cacheHit,
        totalResults: result.totalResults ?? (Array.isArray(result.results) ? result.results.length : 0),
        ...bridgeFields,
    };
}

function buildXResponse(runContext, result, durationMs, cacheMeta = {}) {
    return {
        ...result,
        platform: 'x',
        scrapeType: runContext.scrapeType,
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
        metrics: buildXMetrics(runContext.scrapeType, result, durationMs, cacheMeta.hit === true),
    };
}

function buildXHistoryEntry(runContext, response, options = {}) {
    const metrics = response?.metrics || {};
    return {
        run_id: runContext.runId,
        skill_id: runContext.skillId,
        tool_name: runContext.scrapeType,
        timestamp: new Date().toISOString(),
        input_summary: summarizeInput(runContext.normalizedInput),
        status: options.status || metrics.status || 'success',
        duration_ms: options.durationMs,
        cache_hit: options.cacheHit === true,
        cache_key: runContext.cacheKey,
        debug_bundle_path: options.debugBundlePath || '',
        error_summary: options.errorSummary || '',
        total_results: metrics.totalResults ?? null,
        total_requested: metrics.totalRequested ?? null,
        total_success: metrics.totalSuccess ?? null,
        total_failed: metrics.totalFailed ?? null,
    };
}

function attachXCacheHit(runContext, cached, startedAtMs) {
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
    appendHistory(runContext, buildXHistoryEntry(runContext, response, {
        durationMs: cacheDurationMs,
        cacheHit: true,
    }));
    return response;
}

  return {
    noop,
    makeLog,
    openAndWait,
    clone,
    summarizeInput,
    createRecordingLogger,
    createXRunContext,
    buildXMetrics,
    buildXResponse,
    buildXHistoryEntry,
    attachXCacheHit,
  };
}

module.exports = { createMethods };
