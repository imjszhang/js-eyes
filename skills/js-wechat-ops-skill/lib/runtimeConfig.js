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

function resolveRuntimeConfig(overrides = {}) {
  const globalConfig = safeLoadGlobalConfig();
  return {
    globalConfig,
    serverUrl: resolveServerUrl(globalConfig, overrides),
    recording: resolveRecordingConfig(globalConfig, overrides.recording),
  };
}

module.exports = {
  resolveRecordingConfig,
  resolveRuntimeConfig,
  safeLoadGlobalConfig,
};
