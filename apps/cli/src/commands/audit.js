'use strict';

const {
  ensureRuntimePaths,
  fs,
  print,
} = require('../command-context');

async function commandAudit(positionals, flags) {
  const action = positionals[1];
  const paths = ensureRuntimePaths();
  if (action !== 'tail') {
    throw new Error('用法: `js-eyes audit tail [--lines 100] [--since <iso>]`');
  }
  if (!fs.existsSync(paths.auditLogFile)) {
    print(`No audit log yet at ${paths.auditLogFile}`);
    return;
  }
  const limit = Number(flags.lines || 100);
  const since = flags.since ? new Date(flags.since).getTime() : null;
  const raw = fs.readFileSync(paths.auditLogFile, 'utf8').split('\n').filter(Boolean);
  let rows = raw.slice(-Math.max(limit * 4, limit)).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  if (since !== null && !Number.isNaN(since)) {
    rows = rows.filter((r) => new Date(r.ts || 0).getTime() >= since);
  }
  rows = rows.slice(-limit);
  for (const row of rows) {
    print(JSON.stringify(row));
  }
}

module.exports = { commandAudit };
