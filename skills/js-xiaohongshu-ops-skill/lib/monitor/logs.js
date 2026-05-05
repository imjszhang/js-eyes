'use strict';

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
