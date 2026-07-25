'use strict';

/**
 * 极简的 runtimeConfig：只负责解析 serverUrl。
 *
 * 现有 skills/ 里的 skill 依赖 @js-eyes/config 去合并全局配置与 recording 策略，
 * 本样例刻意不引入，保持最小依赖。生产 skill 建议参考 skills/js-x-ops-skill/lib/runtimeConfig.js。
 */

function resolveServerUrl(overrides = {}) {
  if (overrides.serverUrl) return overrides.serverUrl;
  if (overrides.jsEyesServerUrl) return overrides.jsEyesServerUrl;

  const host = overrides.serverHost || process.env.JS_EYES_SERVER_HOST || 'localhost';
  const port = overrides.serverPort || process.env.JS_EYES_SERVER_PORT || 18080;
  return `ws://${host}:${port}`;
}

function resolveRuntimeConfig(overrides = {}) {
  return {
    serverUrl: resolveServerUrl(overrides),
  };
}

module.exports = {
  resolveServerUrl,
  resolveRuntimeConfig,
};
