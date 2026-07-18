'use strict';

const { loadConfig, mergeRecordingConfig } = require('@js-eyes/config');

function safeLoadGlobalConfig() {
  try {
    return loadConfig();
  } catch (_) {
    return {};
  }
}

function resolveServerUrl(globalConfig, overrides = {}) {
  return overrides.jsEyesServerUrl
    || overrides.browserServer
    || overrides.serverUrl
    || `ws://${globalConfig.serverHost || 'localhost'}:${globalConfig.serverPort || 18080}`;
}

function resolveRecordingConfig(globalConfig = {}, overrides = {}) {
  return mergeRecordingConfig(globalConfig.recording, overrides);
}

const DEFAULT_REQUEST_TIMEOUT_SEC = 1800;

function resolveRequestTimeoutSec(overrides = {}) {
  if (overrides.requestTimeout != null) {
    const n = Number(overrides.requestTimeout);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const envVal = Number(process.env.JS_X_OPS_REQUEST_TIMEOUT);
  if (Number.isFinite(envVal) && envVal > 0) return Math.floor(envVal);
  const globalConfig = safeLoadGlobalConfig();
  const cfgVal = Number(globalConfig.requestTimeout);
  if (Number.isFinite(cfgVal) && cfgVal > 0) return Math.floor(cfgVal);
  return DEFAULT_REQUEST_TIMEOUT_SEC;
}

function resolveRuntimeConfig(overrides = {}) {
  const globalConfig = safeLoadGlobalConfig();
  return {
    globalConfig,
    serverUrl: resolveServerUrl(globalConfig, overrides),
    recording: resolveRecordingConfig(globalConfig, overrides.recording),
    requestTimeoutSec: resolveRequestTimeoutSec(overrides),
  };
}

module.exports = {
  DEFAULT_REQUEST_TIMEOUT_SEC,
  resolveRecordingConfig,
  resolveRequestTimeoutSec,
  resolveRuntimeConfig,
  safeLoadGlobalConfig,
};
