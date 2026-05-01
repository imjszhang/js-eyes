'use strict';

/**
 * monitor paths
 *
 * 目录约定：
 *   ~/.js-eyes/skill-data/js-x-ops-skill/monitor/
 *     ├── config.json
 *     ├── state/<username>.json
 *     ├── logs/check-YYYYMMDD.log
 *     └── daemon.pid
 *
 * 解析优先级（resolveMonitorHome）：
 *   1. 显式传入的 { home } 参数（PR-2 起，用于 moltbook 这类第三方复用 monitor 状态机时指定独立 home）
 *   2. 环境变量 JS_X_MONITOR_HOME（测试 / CI 用）
 *   3. 默认 ~/.js-eyes/skill-data/js-x-ops-skill/monitor/
 */

const path = require('path');
const os = require('os');

function resolveMonitorHome(opts) {
  const home = opts && opts.home;
  if (home) {
    return path.resolve(home);
  }
  if (process.env.JS_X_MONITOR_HOME) {
    return path.resolve(process.env.JS_X_MONITOR_HOME);
  }
  const userHome = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(userHome, '.js-eyes', 'skill-data', 'js-x-ops-skill', 'monitor');
}

function resolvePaths(opts) {
  const base = resolveMonitorHome(opts);
  return {
    base,
    configFile: path.join(base, 'config.json'),
    stateDir: path.join(base, 'state'),
    logsDir: path.join(base, 'logs'),
    pidFile: path.join(base, 'daemon.pid'),
  };
}

function stateFile(username, opts) {
  const { stateDir } = resolvePaths(opts);
  return path.join(stateDir, `${String(username).toLowerCase()}.json`);
}

function logFileFor(date = new Date(), opts) {
  const { logsDir } = resolvePaths(opts);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return path.join(logsDir, `check-${y}${m}${d}.log`);
}

module.exports = {
  resolveMonitorHome,
  resolvePaths,
  stateFile,
  logFileFor,
};
