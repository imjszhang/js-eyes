'use strict';

/**
 * monitor paths（xhs 版）
 *
 * 目录约定：
 *   ~/.js-eyes/skill-data/js-xiaohongshu-ops-skill/monitor/
 *     ├── config.json
 *     ├── state/
 *     │     ├── user-<userId>.json    （账号 target）
 *     │     └── search-<hash>.json    （关键词搜索 target）
 *     ├── logs/check-YYYYMMDD.log
 *     └── daemon.pid
 *
 * 解析优先级：opts.home > env JS_XHS_MONITOR_HOME > 默认。
 */

const path = require('path');
const os = require('os');
const crypto = require('crypto');

function resolveMonitorHome(opts) {
  const home = opts && opts.home;
  if (home) return path.resolve(home);
  if (process.env.JS_XHS_MONITOR_HOME) return path.resolve(process.env.JS_XHS_MONITOR_HOME);
  const userHome = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(userHome, '.js-eyes', 'skill-data', 'js-xiaohongshu-ops-skill', 'monitor');
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

function searchKeyHash(payload) {
  const norm = JSON.stringify(payload || {});
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 12);
}

function targetStateKey(target) {
  if (!target) return null;
  if (target.type === 'account' && target.username) {
    return `user-${String(target.username).toLowerCase()}`;
  }
  if (target.type === 'search' && target.keyword) {
    const hash = searchKeyHash({
      keyword: target.keyword,
      channelType: target.channelType || null,
      sortBy: target.sortBy || null,
      contentType: target.contentType || null,
      timeRange: target.timeRange || null,
      searchScope: target.searchScope || null,
    });
    return `search-${hash}`;
  }
  return null;
}

function stateFileForTarget(target, opts) {
  const key = targetStateKey(target);
  if (!key) return null;
  const { stateDir } = resolvePaths(opts);
  return path.join(stateDir, `${key}.json`);
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
  targetStateKey,
  stateFileForTarget,
  logFileFor,
  searchKeyHash,
};
