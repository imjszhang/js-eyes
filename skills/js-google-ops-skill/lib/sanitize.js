'use strict';

const SENSITIVE_KEY = /cookie|token|auth|sid|session|email|password|screenshot|base64|html|script/i;

function sanitizeForRecording(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(sanitizeForRecording);
  if (typeof value !== 'object') {
    const text = String(value);
    if (text.length > 400 && /<html|<!doctype|data:image\//i.test(text)) return '[REDACTED]';
    return value;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) out[key] = '[MASKED]';
    else out[key] = sanitizeForRecording(item);
  }
  return out;
}

function summarizeInput(value) {
  try { return JSON.stringify(sanitizeForRecording(value)); } catch (_) { return '[unserializable]'; }
}

module.exports = { sanitizeForRecording, summarizeInput };
