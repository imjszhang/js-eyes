'use strict';

/**
 * antiCrawlingStats - 在 node 侧落盘的反爬统计（裁剪自 agent-js）。
 *
 * 与 bridge 内的 module-scope `antiCrawl` 状态机互补：
 *   - bridge: 实时记录"连续 risk hit / 暂停"
 *   - node:   汇总每次 runTool 抓回的 antiCrawlState 到磁盘，便于事后排障
 *
 * 落盘路径：~/.js-eyes/skill-data/js-xiaohongshu-ops-skill/anti-crawling.json
 * （可由 JS_XHS_ANTI_CRAWL_STATS_FILE 覆盖）。
 *
 * 写盘是 best-effort，绝不抛错。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function _defaultFile() {
  if (process.env.JS_XHS_ANTI_CRAWL_STATS_FILE) {
    return path.resolve(process.env.JS_XHS_ANTI_CRAWL_STATS_FILE);
  }
  const base = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(base, '.js-eyes', 'skill-data', 'js-xiaohongshu-ops-skill', 'anti-crawling.json');
}

function _emptyStats() {
  return {
    $version: 1,
    totalCalls: 0,
    totalRiskHits: 0,
    pauseEvents: 0,
    longestPauseMs: 0,
    consecutiveRiskHitsMax: 0,
    lastPauseAt: null,
    lastReason: null,
    perTool: {},
  };
}

function _loadStats(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return _emptyStats();
    if (!parsed.perTool) parsed.perTool = {};
    return parsed;
  } catch (_) {
    return _emptyStats();
  }
}

function _saveStats(stats, file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(stats, null, 2));
    fs.renameSync(file + '.tmp', file);
  } catch (err) {
    try { process.stderr.write(`[anti-crawl-stats] save failed: ${err.message}\n`); } catch {}
  }
}

/**
 * recordCall - 把一次 runTool 的 antiCrawlState 累加到统计。
 *
 * @param {Object} params
 * @param {string} params.toolName
 * @param {Object|null} params.antiCrawlState  来自 bridge response
 * @param {string} [params.reason]             失败原因 / 'ok'
 * @param {string} [params.file]               覆盖落盘路径
 */
function recordCall({ toolName, antiCrawlState, reason, file }) {
  const f = file || _defaultFile();
  const stats = _loadStats(f);
  stats.totalCalls = (stats.totalCalls | 0) + 1;
  if (antiCrawlState) {
    if (antiCrawlState.consecutiveRiskHits) {
      stats.totalRiskHits = (stats.totalRiskHits | 0) + 1;
      stats.consecutiveRiskHitsMax = Math.max(
        stats.consecutiveRiskHitsMax | 0,
        antiCrawlState.consecutiveRiskHits | 0,
      );
    }
    if (antiCrawlState.paused) {
      stats.pauseEvents = (stats.pauseEvents | 0) + 1;
      stats.lastPauseAt = new Date().toISOString();
      const remaining = (antiCrawlState.pauseUntil || 0) - Date.now();
      if (remaining > stats.longestPauseMs) stats.longestPauseMs = remaining;
    }
  }
  if (reason) stats.lastReason = reason;
  if (toolName) {
    const t = stats.perTool[toolName] || { calls: 0, riskHits: 0 };
    t.calls = (t.calls | 0) + 1;
    if (antiCrawlState && antiCrawlState.consecutiveRiskHits) t.riskHits = (t.riskHits | 0) + 1;
    stats.perTool[toolName] = t;
  }
  _saveStats(stats, f);
  return stats;
}

function readStats(file) {
  return _loadStats(file || _defaultFile());
}

function resetStats(file) {
  const f = file || _defaultFile();
  _saveStats(_emptyStats(), f);
}

module.exports = { recordCall, readStats, resetStats };
