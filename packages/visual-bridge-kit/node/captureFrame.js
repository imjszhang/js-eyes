'use strict';

// @js-eyes/visual-bridge-kit · node/captureFrame.js
// ---------------------------------------------------------------------------
// 把 chrome.tabs.captureVisibleTab 拿到的 dataUrl / Buffer 写到
// `<recordDir>/frames/<ts>.png`。fire-and-forget：失败/节流时静默吞错，
// 永远不阻塞主调用。
//
// 用法（skill 端）：
//   const writeFrame = makeFrameWriter({ recordDir, getTabId, captureScreenshot, throttle });
//   wrapInjectCall(ctx, hint, fn, { captureFrame: writeFrame });
//
// 节流：默认 60 帧 / 会话上限 + 每 250ms 至多一帧（防止瞬发动作刷屏）。
// 这两个值能通过 `throttle` 覆盖。
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

function ensureDir(dir){
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

/**
 * 把 dataUrl 或 buffer 写入文件。dataUrl 格式 'data:image/png;base64,...'.
 */
function writeFrameSync(filePath, payload){
  ensureDir(path.dirname(filePath));
  if (Buffer.isBuffer(payload)) {
    fs.writeFileSync(filePath, payload);
    return true;
  }
  if (typeof payload === 'string') {
    const m = /^data:([^;]+);base64,(.*)$/.exec(payload);
    if (!m) return false;
    const buf = Buffer.from(m[2], 'base64');
    fs.writeFileSync(filePath, buf);
    return true;
  }
  if (payload && typeof payload === 'object' && payload.dataUrl) {
    return writeFrameSync(filePath, payload.dataUrl);
  }
  return false;
}

/**
 * @param {object} opts
 * @param {string} opts.recordDir          会话包目录绝对路径
 * @param {() => (number | Promise<number>)} opts.getTabId
 * @param {(tabId: number, options?: object) => Promise<{ dataUrl?, skipped?, format? }>} opts.captureScreenshot
 *        - 通常传 BrowserAutomation.captureScreenshot.bind(bot)
 * @param {object} [opts.throttle]
 * @param {number} [opts.throttle.maxFrames=60]
 * @param {number} [opts.throttle.minIntervalMs=250]
 * @param {object} [opts.logger]            可选，console.warn 兼容接口
 */
function makeFrameWriter(opts){
  const o = opts || {};
  const recordDir = o.recordDir;
  const getTabId = o.getTabId;
  const captureScreenshot = o.captureScreenshot;
  const throttle = Object.assign({ maxFrames: 60, minIntervalMs: 250 }, o.throttle || {});
  const logger = o.logger || null;

  if (!recordDir || typeof getTabId !== 'function' || typeof captureScreenshot !== 'function') {
    return null;
  }

  let frameCount = 0;
  let lastWroteAt = 0;
  let inFlight = false;
  let warnedSkipped = false;

  return async function captureFrame(info){
    try {
      if (!info || !info.ts || !info.frameRef) return;
      if (frameCount >= throttle.maxFrames) return;
      const now = Date.now();
      if (now - lastWroteAt < throttle.minIntervalMs) return;
      if (inFlight) return;
      inFlight = true;
      lastWroteAt = now;

      let tabId = null;
      try { tabId = await getTabId(); } catch (_) { tabId = null; }
      if (tabId == null) { inFlight = false; return; }

      let resp;
      try {
        resp = await captureScreenshot(tabId, { format: 'png' });
      } catch (_) {
        inFlight = false;
        return;
      }
      if (!resp || resp.skipped) {
        if (resp && resp.skipped && !warnedSkipped && logger && typeof logger.warn === 'function') {
          warnedSkipped = true;
          logger.warn('[visual-bridge-kit] captureFrame skipped: ' + resp.skipped + ' (tab not active). Background tabs cannot be captured by chrome.tabs.captureVisibleTab.');
        }
        inFlight = false;
        return;
      }
      if (!resp.dataUrl) { inFlight = false; return; }

      const filePath = path.join(recordDir, info.frameRef);
      const ok = writeFrameSync(filePath, resp.dataUrl);
      if (ok) frameCount += 1;
    } catch (err) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[visual-bridge-kit] captureFrame failed: ' + (err && err.message ? err.message : String(err)));
      }
    } finally {
      inFlight = false;
    }
  };
}

module.exports = { makeFrameWriter, writeFrameSync };
