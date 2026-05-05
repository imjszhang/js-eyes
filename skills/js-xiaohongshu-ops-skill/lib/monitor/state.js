'use strict';

/**
 * monitor state（xhs 版）
 *
 * 每个 target 一个 JSON 文件：
 *   { target, lastCheck, lastError, notes: [{ noteId, hash, publishTime, discoveredAt, notifiedAt?, notifyOk? }] }
 */

const fs = require('fs');
const path = require('path');
const { stateFileForTarget, resolvePaths, targetStateKey } = require('./paths');

function loadState(target, opts) {
  const file = stateFileForTarget(target, opts);
  if (!file) {
    const err = new Error(`monitor:state: 无法解析 target key (target=${JSON.stringify(target)})`);
    err.code = 'E_BAD_TARGET';
    throw err;
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.notes)) parsed.notes = [];
    if (!parsed.target) parsed.target = target;
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { target: target, lastCheck: null, lastError: null, notes: [] };
    }
    throw err;
  }
}

function saveState(target, state, opts) {
  const { stateDir } = resolvePaths(opts);
  fs.mkdirSync(stateDir, { recursive: true });
  const file = stateFileForTarget(target, opts);
  if (!file) {
    const err = new Error('monitor:state: saveState 无法解析 target key');
    err.code = 'E_BAD_TARGET';
    throw err;
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
  return file;
}

function listStateFiles(opts) {
  const { stateDir } = resolvePaths(opts);
  try {
    return fs.readdirSync(stateDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(stateDir, f));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function allStates(opts) {
  return listStateFiles(opts).map((file) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
  }).filter(Boolean);
}

module.exports = {
  loadState,
  saveState,
  listStateFiles,
  allStates,
  targetStateKey,
};
