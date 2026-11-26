'use strict';

const fs = require('fs');
const path = require('path');

const MAX_PARAM_PREVIEW = 256;

function sanitizeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_PARAM_PREVIEW
      ? value.slice(0, MAX_PARAM_PREVIEW) + `…(+${value.length - MAX_PARAM_PREVIEW})`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return `array(len=${value.length})`;
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value);
      return json.length > MAX_PARAM_PREVIEW
        ? json.slice(0, MAX_PARAM_PREVIEW) + `…(+${json.length - MAX_PARAM_PREVIEW})`
        : json;
    } catch {
      return '[object]';
    }
  }
  return String(value);
}

function sanitizeRecord(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = sanitizeValue(value);
  }
  return out;
}

function createAuditLogger(options = {}) {
  const filePath = options.filePath;
  const fallback = options.fallbackLogger || console;
  let stream = null;

  function ensureStream() {
    if (!filePath) return null;
    if (stream) return stream;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      stream = fs.createWriteStream(filePath, { flags: 'a', mode: 0o600 });
      try {
        fs.chmodSync(filePath, 0o600);
      } catch {}
      return stream;
    } catch (error) {
      fallback.warn?.(`[js-eyes] Audit log open failed: ${error.message}`);
      return null;
    }
  }

  function write(event, payload = {}) {
    const record = {
      ts: new Date().toISOString(),
      event,
      ...sanitizeRecord(payload),
    };
    const line = JSON.stringify(record) + '\n';
    const s = ensureStream();
    if (s) {
      try { s.write(line); } catch {}
    }
  }

  function close() {
    if (stream) {
      try { stream.end(); } catch {}
      stream = null;
    }
  }

  return { write, close };
}

const NOOP_AUDIT = {
  write() {},
  close() {},
};

module.exports = {
  createAuditLogger,
  NOOP_AUDIT,
  sanitizeRecord,
  sanitizeValue,
};
