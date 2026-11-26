'use strict';

function stringify(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false, originalLength: text.length };
  return {
    text: `${text.slice(0, maxChars)}\n\n[truncated by js-eyes-mcp]`,
    truncated: true,
    originalLength: text.length,
  };
}

function dataResult(summary, value, options = {}) {
  const maxChars = options.maxChars || 100000;
  const rendered = truncate(options.text == null ? stringify(value) : String(options.text), maxChars);
  const structured = options.structured || (
    value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : { value }
  );
  return {
    content: [{ type: 'text', text: summary ? `${summary}\n${rendered.text}` : rendered.text }],
    structuredContent: {
      ...structured,
      truncated: rendered.truncated,
      ...(rendered.truncated ? { originalLength: rendered.originalLength } : {}),
    },
  };
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], data: match[2].replace(/[\r\n]/g, '') };
}

function screenshotResult(screenshot) {
  const metadata = {
    tabId: screenshot.tabId,
    windowId: screenshot.windowId,
    format: screenshot.format,
    width: screenshot.width,
    height: screenshot.height,
    fullPage: screenshot.fullPage,
    pageWidth: screenshot.pageWidth,
    pageHeight: screenshot.pageHeight,
    viewportWidth: screenshot.viewportWidth,
    viewportHeight: screenshot.viewportHeight,
    devicePixelRatio: screenshot.devicePixelRatio,
    skipped: screenshot.skipped,
  };
  const images = [];
  const main = parseDataUrl(screenshot.dataUrl);
  if (main) images.push({ type: 'image', mimeType: main.mimeType, data: main.data });
  for (const segment of screenshot.segments || []) {
    const parsed = parseDataUrl(typeof segment === 'string' ? segment : segment?.dataUrl);
    if (parsed) images.push({ type: 'image', mimeType: parsed.mimeType, data: parsed.data });
  }
  return {
    content: [
      { type: 'text', text: JSON.stringify(metadata, null, 2) },
      ...images,
    ],
    structuredContent: { ...metadata, imageCount: images.length },
  };
}

function recordingResult(recording) {
  const rec = recording || {};
  const frames = Array.isArray(rec.frames) ? rec.frames : [];
  const metadata = {
    recordingId: rec.recordingId ?? null,
    tabId: rec.tabId ?? null,
    mode: rec.mode ?? null,
    format: rec.format ?? null,
    startedAt: rec.startedAt ?? null,
    stoppedAt: rec.stoppedAt ?? null,
    durationMs: rec.durationMs ?? 0,
    frameCount: rec.frameCount ?? frames.length,
    droppedFrames: rec.droppedFrames ?? 0,
    truncated: Boolean(rec.truncated),
    width: rec.width ?? null,
    height: rec.height ?? null,
    totalBytes: rec.totalBytes ?? 0,
  };
  const images = [];
  const sampleIndexes = frames.length <= 2
    ? frames.map((_, idx) => idx)
    : [0, frames.length - 1];
  for (const idx of sampleIndexes) {
    const parsed = parseDataUrl(frames[idx] && frames[idx].dataUrl);
    if (parsed) images.push({ type: 'image', mimeType: parsed.mimeType, data: parsed.data });
  }
  return {
    content: [
      { type: 'text', text: JSON.stringify(metadata, null, 2) },
      ...images,
    ],
    structuredContent: { ...metadata, previewImageCount: images.length },
  };
}

module.exports = { dataResult, parseDataUrl, recordingResult, screenshotResult, truncate };
