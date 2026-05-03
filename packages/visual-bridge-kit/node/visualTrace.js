'use strict';

// @js-eyes/visual-bridge-kit · node/visualTrace.js
// ---------------------------------------------------------------------------
// 把每次工具调用产生的 visual events append 到 jsonl。
// 一个工具调用 = 一行 JSON（包含 events 数组与 hint/summary 概要）。
//
// 支持两种落盘形态：
//   - appendVisualTrace(filePath, entry)
//       老接口，单文件 jsonl；reddit/browser-ops 现有路径仍走这里。
//   - appendVisualSession(dir, entry, opts?)
//       新接口，会话包目录形态：
//         <dir>/events.jsonl
//         <dir>/meta.json     首次写入时初始化（kit 版本/起止时间/sessionId 等）
//         <dir>/frames/       legacy PNG 路线下才会被 dev 工具创建；A 路线主链路不创建
//       下游消费者（visual-replay-hyperframes）只读会话包目录。
//
// post-2.7.0 architecture pivot：
//   - meta.json 新增 payloadSchemaVersion: 1，标记 events 中携带 hint.kind + payload
//     结构化业务数据（取代 anchor.rect / viewport / frameRef）。
//   - meta.redact / frameCount 不再写入主链路；保留字段只为兼容旧会话读 fixture。
//   - events 中 payload 形状由 hint.kind 决定（详见 visual-replay-hyperframes 模板层
//     PAYLOAD_SCHEMA 文档）：
//       kind:'list'       => { items: [{ id, title, author, subreddit, score, comments,
//                                          flair, thumbnail, permalink, createdAt,
//                                          contentPreview }], totalCount, sub, sort }
//       kind:'item'       => 单条上述 item shape（外层不再包 items）
//       kind:'tree'       => { items: [...], relations: [{ from, to, depth }] }
//       kind:'global'     => { summary: string, fields: [{ k, v }] }
//       kind:'navigation' => { from: url, to: url, hint: 'page_will_reload' }
//       kind:'write'      => 待补，首版按 'global' 处理
// ---------------------------------------------------------------------------

const PAYLOAD_SCHEMA_VERSION = 1;

const fs = require('fs');
const path = require('path');

const KIT_VERSION = (() => {
  try { return require('../package.json').version || ''; }
  catch (_) { return ''; }
})();

function ensureDir(filePath){
  const dir = path.dirname(filePath);
  if (!dir) return;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

function ensureDirAt(dirPath){
  if (!dirPath) return;
  try { fs.mkdirSync(dirPath, { recursive: true }); } catch (_) {}
}

function readJsonSafe(filePath){
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeJsonSafe(filePath, value){
  try {
    ensureDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
    return true;
  } catch (_) {
    return false;
  }
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

/**
 * appendVisualSession - 把一条 trace 写入会话包目录。
 *
 * 与 appendVisualTrace 的区别：
 *   - 第一参数是目录而不是文件
 *   - 首次写入时写 meta.json（kit 版本 / startedAt / sessionId / skillId）
 *   - events 写到 <dir>/events.jsonl
 *
 * @param {string|null} dir - 会话包目录路径；falsy 则 noop
 * @param {object} entry - 同 appendVisualTrace 的 entry
 * @param {object} [opts]
 * @param {string} [opts.sessionId]
 * @param {string} [opts.skillId]
 * @param {string} [opts.skillVersion]
 * @returns {boolean}
 */
function appendVisualSession(dir, entry, opts){
  if (!dir) return false;
  const o = opts || {};
  try {
    ensureDirAt(dir);
    const metaPath = path.join(dir, 'meta.json');
    let meta = readJsonSafe(metaPath);
    if (!meta) {
      meta = {
        sessionId: o.sessionId || makeSessionId(),
        startedAt: new Date().toISOString(),
        kitVersion: KIT_VERSION,
        skillId: o.skillId || (entry && entry.skillId) || '',
        skillVersion: o.skillVersion || '',
        payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
        toolNames: [],
        eventCount: 0,
      };
    }
    // v0.5.0：updateVisualSessionMeta 可能在 appendVisualSession 之前先写入 viewport
    // 等字段，导致 skillId/skillVersion 缺失。这里在每次 append 时回填。
    if (!meta.skillId && (o.skillId || (entry && entry.skillId))) {
      meta.skillId = o.skillId || entry.skillId;
    }
    if (!meta.skillVersion && o.skillVersion) {
      meta.skillVersion = o.skillVersion;
    }
    if (meta.payloadSchemaVersion == null) meta.payloadSchemaVersion = PAYLOAD_SCHEMA_VERSION;
    if (entry && entry.toolName && Array.isArray(meta.toolNames) && meta.toolNames.indexOf(entry.toolName) < 0) {
      meta.toolNames.push(entry.toolName);
    }
    meta.eventCount = (meta.eventCount || 0) + (Array.isArray(entry && entry.events) ? entry.events.length : 0);
    meta.updatedAt = new Date().toISOString();
    writeJsonSafe(metaPath, meta);

    const eventsPath = path.join(dir, 'events.jsonl');
    const safe = Object.assign({ ts: new Date().toISOString(), sessionId: meta.sessionId }, entry || {});
    fs.appendFileSync(eventsPath, JSON.stringify(safe) + '\n', 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function makeSessionId(){
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return 'sess-' + t + '-' + r;
}

/**
 * readVisualSession - 读会话包：返回 { meta, entries }。
 */
function readVisualSession(dir){
  if (!dir) return { meta: null, entries: [] };
  const metaPath = path.join(dir, 'meta.json');
  const eventsPath = path.join(dir, 'events.jsonl');
  const meta = readJsonSafe(metaPath);
  const entries = readVisualTrace(eventsPath);
  return { meta, entries };
}

/**
 * updateVisualSessionMeta - 浅合并写入 meta.json 的字段。如果文件不存在则创建。
 * v0.5.0 主要用于：snapshot mode 下 runTool 在首次 ensureBridge 后写入
 *   { viewport, frames: { format, quality, hiDpi, maxFrames } }
 *
 * @param {string} dir 会话包目录
 * @param {object} patch 浅合并对象
 * @returns {boolean}
 */
function updateVisualSessionMeta(dir, patch){
  if (!dir || !patch || typeof patch !== 'object') return false;
  try {
    ensureDirAt(dir);
    const metaPath = path.join(dir, 'meta.json');
    let meta = readJsonSafe(metaPath);
    if (!meta) {
      meta = {
        sessionId: makeSessionId(),
        startedAt: new Date().toISOString(),
        kitVersion: KIT_VERSION,
        payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
        toolNames: [],
        eventCount: 0,
      };
    }
    Object.assign(meta, patch);
    meta.updatedAt = new Date().toISOString();
    writeJsonSafe(metaPath, meta);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  appendVisualTrace,
  readVisualTrace,
  appendVisualSession,
  readVisualSession,
  updateVisualSessionMeta,
  KIT_VERSION,
  PAYLOAD_SCHEMA_VERSION,
};
