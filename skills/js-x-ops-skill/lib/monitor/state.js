'use strict';

/**
 * monitor per-account state
 *
 * 每个账号一个 JSON 文件，schema：
 * {
 *   username,
 *   lastCheck: ISO,
 *   lastError: string|null,
 *   tweets: [{ tweetId, hash, publishTime, discoveredAt, notifiedAt?: ISO, notifyOk?: bool }]
 * }
 *
 * PR-2 起，loadState/saveState/listStateFiles/allStates 都接受可选的
 * { home } 参数，用于把 state 定位到非默认 monitor home（例如 moltbook 的
 * data/monitor-state/kol-patrol/），避免污染 ops-skill 自己的 monitor 目录。
 */

const fs = require('fs');
const path = require('path');
const { stateFile, resolvePaths } = require('./paths');

function loadState(username, opts) {
  const file = stateFile(username, opts);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.tweets)) parsed.tweets = [];
    if (!parsed.username) parsed.username = username;
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        username,
        lastCheck: null,
        lastError: null,
        tweets: [],
      };
    }
    throw err;
  }
}

function saveState(username, state, opts) {
  const { stateDir } = resolvePaths(opts);
  fs.mkdirSync(stateDir, { recursive: true });
  const file = stateFile(username, opts);
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
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed;
    } catch {
      return null;
    }
  }).filter(Boolean);
}

module.exports = {
  loadState,
  saveState,
  listStateFiles,
  allStates,
};
