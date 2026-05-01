'use strict';

/**
 * monitor logs - 落盘到 monitor/logs/check-YYYYMMDD.log
 *
 * 纯追加写，单行 JSON（JSONL）。绝不抛错；写失败时 swallow 到 stderr，避免影响主循环。
 */

const fs = require('fs');
const { logFileFor, resolvePaths } = require('./paths');

function appendLog(entry, now = new Date()) {
  const file = logFileFor(now);
  try {
    const { logsDir } = resolvePaths();
    fs.mkdirSync(logsDir, { recursive: true });
    const payload = Object.assign({ timestamp: now.toISOString() }, entry || {});
    fs.appendFileSync(file, JSON.stringify(payload) + '\n');
  } catch (err) {
    try { process.stderr.write(`[monitor:logs] appendLog failed: ${err.message}\n`); } catch {}
  }
}

module.exports = { appendLog };
