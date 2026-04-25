'use strict';

// extra-integrity: optional snapshot-and-verify layer for extraSkillDirs.
//
// Gated by `security.verifyExtraSkillDirs` (default false for 2.6.1
// compatibility). When enabled:
//   * `js-eyes skills link <path>` calls `snapshotExtraDir(path)` to record a
//     per-file sha256 map under ~/.js-eyes/state/extras/<hash>.json (the state
//     file lives outside the external dir so js-eyes never writes to it);
//   * the plugin's SkillRegistry calls `verifyExtraDir(path)` before loading
//     each extra; on drift the load is refused and the operator is told to
//     run `js-eyes skills relink <path>` after reviewing the changes.
//
// ClawHub / OpenClaw flagged extraSkillDirs as "read-only but bypass integrity
// verification"; this module closes that gap without breaking the default
// behaviour. See SECURITY_SCAN_NOTES.md.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ensureDir } = require('./fs-io');

const STATE_DIR_NAME = 'state';
const EXTRAS_DIR_NAME = 'extras';
const SNAPSHOT_VERSION = 1;

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveBaseDir(options = {}) {
  if (options.baseDir) return path.resolve(options.baseDir);
  if (process.env.JS_EYES_HOME) return path.resolve(process.env.JS_EYES_HOME);
  return path.join(options.home || os.homedir(), '.js-eyes');
}

function getSnapshotPath(absPath, options = {}) {
  if (!absPath || typeof absPath !== 'string') {
    throw new Error('getSnapshotPath: absPath required');
  }
  const baseDir = resolveBaseDir(options);
  const key = sha1(path.resolve(absPath));
  return path.join(baseDir, STATE_DIR_NAME, EXTRAS_DIR_NAME, `${key}.json`);
}

function listFilesRecursive(dir) {
  const out = [];
  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full);
      if (rel.split(path.sep)[0] === 'node_modules') continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push(rel.split(path.sep).join('/'));
      }
    }
  }
  walk(dir);
  return out.sort();
}

function buildFileMap(absPath) {
  const files = {};
  for (const rel of listFilesRecursive(absPath)) {
    const full = path.join(absPath, rel);
    try {
      files[rel] = sha256File(full);
    } catch (_) {
      // Skip unreadable files; they'll appear as missing in verify.
    }
  }
  return files;
}

function writeSnapshot(absPath, snapshot, options = {}) {
  const target = getSnapshotPath(absPath, options);
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  try { fs.chmodSync(target, 0o600); } catch (_) { /* best-effort on POSIX */ }
  return target;
}

function readSnapshot(absPath, options = {}) {
  const target = getSnapshotPath(absPath, options);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (_) {
    return null;
  }
}

function snapshotExtraDir(absPath, options = {}) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`snapshotExtraDir: path does not exist: ${absPath}`);
  }
  const snapshot = {
    version: SNAPSHOT_VERSION,
    path: path.resolve(absPath),
    createdAt: new Date().toISOString(),
    files: buildFileMap(absPath),
  };
  const snapshotPath = writeSnapshot(absPath, snapshot, options);
  return { snapshot, snapshotPath };
}

function verifyExtraDir(absPath, options = {}) {
  const snapshot = readSnapshot(absPath, options);
  if (!snapshot || !snapshot.files) {
    return {
      ok: false,
      hasSnapshot: false,
      drifted: [],
      missing: [],
      extra: [],
      checked: 0,
    };
  }

  const expected = snapshot.files;
  const expectedKeys = Object.keys(expected);
  const actual = buildFileMap(absPath);

  const drifted = [];
  const missing = [];
  for (const rel of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(actual, rel)) {
      missing.push(rel);
      continue;
    }
    if (actual[rel] !== expected[rel]) {
      drifted.push(rel);
    }
  }
  const extra = Object.keys(actual).filter(
    (rel) => !Object.prototype.hasOwnProperty.call(expected, rel),
  );

  return {
    ok: drifted.length === 0 && missing.length === 0 && extra.length === 0,
    hasSnapshot: true,
    drifted,
    missing,
    extra,
    checked: expectedKeys.length,
    snapshotCreatedAt: snapshot.createdAt || null,
  };
}

function clearSnapshotForExtraDir(absPath, options = {}) {
  const target = getSnapshotPath(absPath, options);
  if (fs.existsSync(target)) {
    try { fs.rmSync(target, { force: true }); } catch (_) { /* best-effort */ }
    return true;
  }
  return false;
}

// Returns one of: 'verified' | 'drifted' | 'missing-snapshot' | 'off' | 'error'.
// `off` means the global toggle is disabled.
function classifyExtraDir(absPath, { enabled, options = {} } = {}) {
  if (!enabled) return { state: 'off' };
  let result;
  try {
    result = verifyExtraDir(absPath, options);
  } catch (error) {
    return { state: 'error', error: error.message };
  }
  if (!result.hasSnapshot) return { state: 'missing-snapshot', detail: result };
  if (result.ok) return { state: 'verified', detail: result };
  return { state: 'drifted', detail: result };
}

module.exports = {
  SNAPSHOT_VERSION,
  getSnapshotPath,
  snapshotExtraDir,
  verifyExtraDir,
  clearSnapshotForExtraDir,
  classifyExtraDir,
  // Exposed for tests only.
  _internals: { buildFileMap, listFilesRecursive, resolveBaseDir },
};
