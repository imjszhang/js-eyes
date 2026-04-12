'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  ensureDir,
  ensureSkillRecordPaths,
  getSkillRecordPaths,
} = require('@js-eyes/runtime-paths');

function createCacheKey(parts) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex');
}

function createRunId(skillId) {
  if (typeof crypto.randomUUID === 'function') {
    return `${skillId}-${crypto.randomUUID()}`;
  }
  return `${skillId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resolveRecordingState(recordingConfig = {}, options = {}) {
  const mode = options.debugRecording
    ? 'debug'
    : (options.recordingMode || recordingConfig.mode || 'standard');

  return {
    mode,
    baseDir: recordingConfig.baseDir || '',
    cacheTtlMinutes: Number(recordingConfig.cacheTtlMinutes || 0),
    saveRawHtml: recordingConfig.saveRawHtml === true,
    maxDebugBundles: Number(recordingConfig.maxDebugBundles || 0),
    historyEnabled: mode !== 'off',
    cacheEnabled: (mode === 'standard' || mode === 'debug') && options.noCache !== true,
    debugEnabled: mode === 'debug',
  };
}

function createSkillRunContext(options = {}) {
  const sourceInput = options.input ?? options.url;
  const normalizeInput = typeof options.normalizeInput === 'function'
    ? options.normalizeInput
    : ((value) => value);
  const normalizedInput = normalizeInput(sourceInput, options);
  const toolName = options.toolName || options.scrapeType || 'unknown_tool';
  const scrapeType = options.scrapeType || toolName;
  const recording = resolveRecordingState(options.recording, options);
  const paths = getSkillRecordPaths(options.skillId, {
    recordingBaseDir: recording.baseDir,
  });
  const cacheKeyParts = typeof options.buildCacheKeyParts === 'function'
    ? options.buildCacheKeyParts({
      skillId: options.skillId,
      toolName,
      scrapeType,
      skillVersion: options.skillVersion,
      input: sourceInput,
      normalizedInput,
      options,
    })
    : {
      skillId: options.skillId,
      toolName,
      input: normalizedInput,
      version: options.skillVersion,
    };

  return {
    skillId: options.skillId,
    toolName,
    scrapeType,
    skillVersion: options.skillVersion,
    input: sourceInput,
    sourceUrl: options.url || sourceInput,
    normalizedInput,
    normalizedUrl: options.url ? normalizedInput : undefined,
    runId: options.runId || createRunId(options.skillId),
    startedAt: options.startedAt || new Date().toISOString(),
    startedAtMs: options.startedAtMs || Date.now(),
    recording,
    paths,
    cacheKey: createCacheKey(cacheKeyParts),
  };
}

function getHistoryFilePath(runContext, timestamp = new Date()) {
  const paths = ensureSkillRecordPaths(runContext.skillId, {
    recordingBaseDir: runContext.recording.baseDir,
  });
  const month = timestamp.toISOString().slice(0, 7);
  return path.join(paths.historyDir, `${month}.jsonl`);
}

function appendHistory(runContext, entry) {
  if (!runContext.recording.historyEnabled) {
    return null;
  }

  const filePath = getHistoryFilePath(runContext);
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
  return filePath;
}

function getCacheFilePath(runContext, namespace = 'default') {
  const paths = ensureSkillRecordPaths(runContext.skillId, {
    recordingBaseDir: runContext.recording.baseDir,
  });
  const namespaceDir = path.join(paths.cacheDir, namespace);
  ensureDir(namespaceDir);
  return path.join(namespaceDir, `${runContext.cacheKey}.json`);
}

function isExpired(entry) {
  if (!entry || !entry.expiresAt) {
    return false;
  }
  return Date.now() > new Date(entry.expiresAt).getTime();
}

function readCacheEntry(runContext, namespace = 'default') {
  if (!runContext.recording.cacheEnabled) {
    return null;
  }

  const filePath = getCacheFilePath(runContext, namespace);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const entry = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (isExpired(entry)) {
      fs.rmSync(filePath, { force: true });
      return null;
    }
    entry.filePath = filePath;
    return entry;
  } catch (_) {
    return null;
  }
}

function writeCacheEntry(runContext, payload, namespace = 'default') {
  if (!runContext.recording.cacheEnabled) {
    return null;
  }

  const filePath = getCacheFilePath(runContext, namespace);
  const createdAt = new Date().toISOString();
  const ttlMinutes = runContext.recording.cacheTtlMinutes;
  const expiresAt = ttlMinutes > 0
    ? new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()
    : null;

  const entry = {
    cacheKey: runContext.cacheKey,
    runId: runContext.runId,
    sourceInput: runContext.input,
    normalizedInput: runContext.normalizedInput,
    sourceUrl: runContext.sourceUrl,
    normalizedUrl: runContext.normalizedUrl,
    toolName: runContext.toolName,
    scrapeType: runContext.scrapeType,
    createdAt,
    expiresAt,
    skillVersion: runContext.skillVersion,
    ...payload,
  };

  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  entry.filePath = filePath;
  return entry;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeJsonLines(filePath, items) {
  const content = (items || []).map((item) => JSON.stringify(item)).join('\n');
  fs.writeFileSync(filePath, content ? content + '\n' : '', 'utf8');
}

function pruneDebugBundles(debugDir, keepCount) {
  if (!keepCount || keepCount <= 0 || !fs.existsSync(debugDir)) {
    return;
  }

  const entries = fs.readdirSync(debugDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(debugDir, entry.name);
      return {
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const entry of entries.slice(keepCount)) {
    fs.rmSync(entry.fullPath, { recursive: true, force: true });
  }
}

function writeDebugBundle(runContext, payload) {
  if (!runContext.recording.debugEnabled) {
    return null;
  }

  const paths = ensureSkillRecordPaths(runContext.skillId, {
    recordingBaseDir: runContext.recording.baseDir,
  });
  const bundleDir = path.join(paths.debugDir, runContext.runId);
  ensureDir(bundleDir);

  writeJson(path.join(bundleDir, 'meta.json'), payload.meta || {});
  writeJsonLines(path.join(bundleDir, 'steps.jsonl'), payload.steps || []);
  writeJsonLines(path.join(bundleDir, 'dom-stats.jsonl'), payload.domStats || []);
  writeJson(path.join(bundleDir, 'result.json'), payload.result || {});

  if (runContext.recording.saveRawHtml && typeof payload.rawHtml === 'string') {
    fs.writeFileSync(path.join(bundleDir, 'raw.html'), payload.rawHtml, 'utf8');
  }

  pruneDebugBundles(paths.debugDir, runContext.recording.maxDebugBundles);
  return bundleDir;
}

function createDebugState() {
  return {
    steps: [],
    domStats: [],
  };
}

function recordStep(debugState, step, details = {}) {
  if (!debugState) {
    return;
  }

  debugState.steps.push({
    timestamp: new Date().toISOString(),
    step,
    ...details,
  });
}

function recordDomStat(debugState, label, stats) {
  if (!debugState || !stats) {
    return;
  }

  debugState.domStats.push({
    timestamp: new Date().toISOString(),
    label,
    ...stats,
  });
}

module.exports = {
  appendHistory,
  createCacheKey,
  createDebugState,
  createRunId,
  createSkillRunContext,
  getCacheFilePath,
  getHistoryFilePath,
  readCacheEntry,
  recordDomStat,
  recordStep,
  resolveRecordingState,
  writeCacheEntry,
  writeDebugBundle,
};
