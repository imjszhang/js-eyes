'use strict';

function createMethods(dependencies = {}) {
function _shouldUseBridge(options) {
    if (options && options.useBridge === false) return false;
    if (process.env.JS_X_DISABLE_BRIDGE === '1') return false;
    return true;
}

function _shouldFallback() {
    return process.env.JS_X_DISABLE_FALLBACK !== '1';
}

function _attachBridgeMetrics(result, info) {
    result._bridgeRoute = {
        bridgeUsed: !!info.bridgeUsed,
        bridgeFallback: !!info.bridgeFallback,
        bridgeFallbackReason: info.bridgeFallbackReason || null,
        bridgeFallbackMessage: info.bridgeFallbackMessage || null,
        bridgeFallbackCode: info.bridgeFallbackCode || null,
        bridgeTarget: info.bridgeTarget || null,
        bridgeVersion: info.bridgeVersion || null,
        bridgeMeta: info.bridgeMeta || null,
    };
    return result;
}

function _readBridgeRoute(result) {
    const route = (result && result._bridgeRoute) || null;
    if (result && result._bridgeRoute) delete result._bridgeRoute;
    return route;
}

  return {
    _shouldUseBridge,
    _shouldFallback,
    _attachBridgeMetrics,
    _readBridgeRoute,
  };
}

module.exports = { createMethods };
