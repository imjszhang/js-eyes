'use strict';

const { loadConfig, mergeRecordingConfig } = require('@js-eyes/config');

function safeLoadGlobalConfig() {
  try {
    return loadConfig();
  } catch (_) {
    return {};
  }
}

function resolveRecordingConfig(globalConfig = {}, overrides = {}) {
  return mergeRecordingConfig(globalConfig.recording, overrides);
}

function resolveRuntimeConfig(overrides = {}) {
  const globalConfig = safeLoadGlobalConfig();
  return {
    globalConfig,
    recording: resolveRecordingConfig(globalConfig, overrides.recording),
  };
}

module.exports = {
  resolveRecordingConfig,
  resolveRuntimeConfig,
  safeLoadGlobalConfig,
};
