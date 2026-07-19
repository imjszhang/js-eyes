'use strict';

function createMethods(dependencies = {}) {
  const { FALLBACK_REASON, _attachBridgeMetrics, _shouldFallback, _shouldUseBridge, classifyBridgeError, homeViaRunTool, makeLog, postViaRunTool, profileViaRunTool, runGetHomeFeed, runGetPost, runGetProfileTweets, runSearchTweets, searchViaRunTool } = dependencies;

function _disabledByOptions(options) {
    return process.env.JS_X_DISABLE_BRIDGE === '1' || (options && options.useBridge === false);
}

function _disabledMessage(options) {
    if (process.env.JS_X_DISABLE_BRIDGE === '1') return 'JS_X_DISABLE_BRIDGE=1';
    if (options && options.useBridge === false) return 'options.useBridge=false';
    return null;
}

async function _profileWithBridgeOrFallback(browser, username, options) {
    const log = makeLog(options.logger);
    const useBridge = _shouldUseBridge(options);
    if (!useBridge) {
        const result = await runGetProfileTweets(browser, username, options);
        return _attachBridgeMetrics(result, {
            bridgeUsed: false,
            bridgeFallback: _disabledByOptions(options),
            bridgeFallbackReason: _disabledByOptions(options) ? FALLBACK_REASON.DISABLED_BY_ENV : null,
            bridgeFallbackMessage: _disabledMessage(options),
        });
    }
    try {
        const result = await profileViaRunTool(browser, username, options);
        const route = result._bridge || {};
        delete result._bridge;
        return _attachBridgeMetrics(result, {
            bridgeUsed: true,
            bridgeFallback: false,
            bridgeTarget: route.target || null,
            bridgeVersion: route.bridge && route.bridge.version || null,
            bridgeMeta: route.meta || null,
        });
    } catch (bridgeError) {
        log.warn(`⚠ bridge profile 失败，回退老路径: ${bridgeError.message}`);
        if (!_shouldFallback()) throw bridgeError;
        const fallback = await runGetProfileTweets(browser, username, options);
        return _attachBridgeMetrics(fallback, {
            bridgeUsed: false,
            bridgeFallback: true,
            bridgeFallbackReason: classifyBridgeError(bridgeError),
            bridgeFallbackMessage: bridgeError.message || String(bridgeError),
            bridgeFallbackCode: bridgeError.code || null,
        });
    }
}

async function _homeWithBridgeOrFallback(browser, options) {
    const log = makeLog(options.logger);
    const useBridge = _shouldUseBridge(options);
    if (!useBridge) {
        const result = await runGetHomeFeed(browser, options);
        return _attachBridgeMetrics(result, {
            bridgeUsed: false,
            bridgeFallback: _disabledByOptions(options),
            bridgeFallbackReason: _disabledByOptions(options) ? FALLBACK_REASON.DISABLED_BY_ENV : null,
            bridgeFallbackMessage: _disabledMessage(options),
        });
    }
    try {
        const result = await homeViaRunTool(browser, options);
        const route = result._bridge || {};
        delete result._bridge;
        return _attachBridgeMetrics(result, {
            bridgeUsed: true,
            bridgeFallback: false,
            bridgeTarget: route.target || null,
            bridgeVersion: route.bridge && route.bridge.version || null,
            bridgeMeta: route.meta || null,
        });
    } catch (bridgeError) {
        log.warn(`⚠ bridge home 失败，回退老路径: ${bridgeError.message}`);
        if (!_shouldFallback()) throw bridgeError;
        const fallback = await runGetHomeFeed(browser, options);
        return _attachBridgeMetrics(fallback, {
            bridgeUsed: false,
            bridgeFallback: true,
            bridgeFallbackReason: classifyBridgeError(bridgeError),
            bridgeFallbackMessage: bridgeError.message || String(bridgeError),
            bridgeFallbackCode: bridgeError.code || null,
        });
    }
}

function _hasWriteParams(options) {
    if (!options) return false;
    return !!(options.post || options.reply || options.quote || options.thread || options.media);
}

async function _postWithBridgeOrFallback(browser, tweetInputs, options) {
    const log = makeLog(options.logger);
    if (_hasWriteParams(options)) {
        return await runGetPost(browser, tweetInputs, options);
    }
    const useBridge = _shouldUseBridge(options);
    if (!useBridge) {
        const result = await runGetPost(browser, tweetInputs, options);
        return _attachBridgeMetrics(result, {
            bridgeUsed: false,
            bridgeFallback: _disabledByOptions(options),
            bridgeFallbackReason: _disabledByOptions(options) ? FALLBACK_REASON.DISABLED_BY_ENV : null,
            bridgeFallbackMessage: _disabledMessage(options),
        });
    }
    try {
        const result = await postViaRunTool(browser, tweetInputs, options);
        const route = result._bridge || {};
        delete result._bridge;
        return _attachBridgeMetrics(result, {
            bridgeUsed: true,
            bridgeFallback: false,
            bridgeTarget: route.target || null,
            bridgeVersion: route.bridge && route.bridge.version || null,
            bridgeMeta: route.meta || null,
        });
    } catch (bridgeError) {
        log.warn(`⚠ bridge post 失败，回退老路径: ${bridgeError.message}`);
        if (!_shouldFallback()) throw bridgeError;
        const fallback = await runGetPost(browser, tweetInputs, options);
        return _attachBridgeMetrics(fallback, {
            bridgeUsed: false,
            bridgeFallback: true,
            bridgeFallbackReason: classifyBridgeError(bridgeError),
            bridgeFallbackMessage: bridgeError.message || String(bridgeError),
            bridgeFallbackCode: bridgeError.code || null,
        });
    }
}

async function _searchWithBridgeOrFallback(browser, keyword, options) {
    const log = makeLog(options.logger);
    const useBridge = _shouldUseBridge(options);
    if (!useBridge) {
        const result = await runSearchTweets(browser, keyword, options);
        return _attachBridgeMetrics(result, {
            bridgeUsed: false,
            bridgeFallback: process.env.JS_X_DISABLE_BRIDGE === '1' || options.useBridge === false,
            bridgeFallbackReason: process.env.JS_X_DISABLE_BRIDGE === '1' || options.useBridge === false
                ? FALLBACK_REASON.DISABLED_BY_ENV : null,
            bridgeFallbackMessage: process.env.JS_X_DISABLE_BRIDGE === '1'
                ? 'JS_X_DISABLE_BRIDGE=1' : (options.useBridge === false ? 'options.useBridge=false' : null),
        });
    }
    try {
        const result = await searchViaRunTool(browser, keyword, options);
        const route = result._bridge || {};
        delete result._bridge;
        return _attachBridgeMetrics(result, {
            bridgeUsed: true,
            bridgeFallback: false,
            bridgeTarget: route.target || null,
            bridgeVersion: route.bridge && route.bridge.version || null,
            bridgeMeta: route.meta || null,
        });
    } catch (bridgeError) {
        log.warn(`⚠ bridge search 失败，回退老路径: ${bridgeError.message}`);
        if (!_shouldFallback()) throw bridgeError;
        const fallback = await runSearchTweets(browser, keyword, options);
        return _attachBridgeMetrics(fallback, {
            bridgeUsed: false,
            bridgeFallback: true,
            bridgeFallbackReason: classifyBridgeError(bridgeError),
            bridgeFallbackMessage: bridgeError.message || String(bridgeError),
            bridgeFallbackCode: bridgeError.code || null,
        });
    }
}

  return {
    _disabledByOptions,
    _disabledMessage,
    _profileWithBridgeOrFallback,
    _homeWithBridgeOrFallback,
    _hasWriteParams,
    _postWithBridgeOrFallback,
    _searchWithBridgeOrFallback,
  };
}

module.exports = { createMethods };
