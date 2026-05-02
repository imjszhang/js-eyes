'use strict';

// @js-eyes/visual-bridge-kit · node/visualTrace.js
// ---------------------------------------------------------------------------
// 把每次工具调用产生的 visual events append 到 jsonl。
// 一个工具调用 = 一行 JSON（包含 events 数组与 hint/summary 概要）。
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

function ensureDir(filePath){
  const dir = path.dirname(filePath);
  if (!dir) return;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

/**
 * appendVisualTrace - 追加一条 trace 行。失败被吞掉（trace 不应阻断主流程）。
 *
 * @param {string|null} tracePath - jsonl 路径；falsy 则 noop
 * @param {object} entry - 单次调用的 trace 元数据 + events
 * @returns {boolean} 是否真的写入
 */
function appendVisualTrace(tracePath, entry){
  if (!tracePath) return false;
  try {
    ensureDir(tracePath);
    const safe = Object.assign({ ts: new Date().toISOString() }, entry || {});
    const line = JSON.stringify(safe);
    fs.appendFileSync(tracePath, line + '\n', 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * readVisualTrace - 读 jsonl 回放（仅供测试 / 回放工具用）。
 */
function readVisualTrace(tracePath){
  if (!tracePath) return [];
  let raw;
  try { raw = fs.readFileSync(tracePath, 'utf8'); } catch (_) { return []; }
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    })
    .filter(Boolean);
}

module.exports = {
  appendVisualTrace,
  readVisualTrace,
};
