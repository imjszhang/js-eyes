'use strict';

// fs-io: pure filesystem helpers.
//
// Scoped deliberately: the functions here do local-only disk I/O and JSON
// parsing. They never touch the network, and this module MUST NOT import
// `ws`, `http`, `https`, `net`, or any network helper. The invariant is
// verified by test/import-boundaries.test.js.
//
// See SECURITY_SCAN_NOTES.md ("File read combined with network send") for
// the reason this module is kept separate from skills.js.

const fs = require('fs');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function safeStat(target) {
  try {
    return fs.statSync(target);
  } catch (_) {
    return null;
  }
}

module.exports = {
  ensureDir,
  readJson,
  safeStat,
};
