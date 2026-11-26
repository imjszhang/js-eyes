'use strict';

(() => {
function resolveInteractCore() {
  try {
    if (typeof require === 'function') {
      return require('@js-eyes/protocol').pageInteractCore
        || require('../../packages/protocol/page-interact-core');
    }
  } catch {}
  if (globalThis.JSEyesPageInteractCore) return globalThis.JSEyesPageInteractCore;
  throw new Error('JSEyesPageInteractCore is unavailable');
}

function hostFromUrl(url) {
  try { return new URL(url).hostname || ''; } catch { return ''; }
}

function basenameOf(filePath) {
  const raw = String(filePath || '');
  const parts = raw.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

function sanitizeDownload(item) {
  return {
    id: String(item.id),
    basename: basenameOf(item.filename),
    state: item.state || 'in_progress',
    bytes: item.fileSize || item.bytesReceived || 0,
    mime: item.mime || '',
    urlHost: hostFromUrl(item.url),
  };
}

function createMethods(extensionApi) {
  if (!extensionApi) throw new TypeError('extensionApi is required');
  const core = resolveInteractCore();
  return {
async _runPageInteract(tabId, func, args) {
    const parsedTabId = parseInt(tabId, 10);
    if (extensionApi.scripting && typeof extensionApi.scripting.executeScript === 'function') {
      const results = await extensionApi.scripting.executeScript({
        target: { tabId: parsedTabId },
        func,
        args,
      });
      return results && results[0] ? results[0].result : null;
    }
    if (extensionApi.tabs && typeof extensionApi.tabs.executeScript === 'function') {
      const results = await extensionApi.tabs.executeScript(parsedTabId, {
        code: `(${func.toString()}).apply(null, ${JSON.stringify(args)})`,
      });
      return Array.isArray(results) ? results[0] : null;
    }
    throw new Error('Browser scripting API is unavailable');
  },

_complete(type, tabId, requestId, result) {
    this.sendMessage({
      type,
      tabId,
      result,
      requestId,
      timestamp: new Date().toISOString(),
    });
  },

_fail(requestId, error, fallbackCode) {
    this.sendMessage({
      type: 'error',
      message: error.message,
      requestId,
      code: error.code || fallbackCode,
    });
  },

async handleClick(message) {
    const { tabId, selector, text, index, ref, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      if (!selector && !text && !ref) throw new Error('必须提供 selector、text 或 ref');
      const result = await this._runPageInteract(tabId, core.clickInPage, [
        selector || '*', text || '', index || 0, ref || '',
      ]);
      this._complete('click_complete', tabId, requestId, result);
    } catch (error) {
      this._fail(requestId, error, 'CLICK_ERROR');
    }
  },

async handleFill(message) {
    const { tabId, selector, value, clearFirst, index, ref, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      if (!selector && !ref) throw new Error('必须提供 selector 或 ref');
      const result = await this._runPageInteract(tabId, core.fillInPage, [
        selector || '', value || '', !!clearFirst, index || 0, ref || '',
      ]);
      this._complete('fill_complete', tabId, requestId, result);
    } catch (error) {
      this._fail(requestId, error, 'FILL_ERROR');
    }
  },

async handleScroll(message) {
    const { tabId, target, selector, pixels, ref, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      const result = await this._runPageInteract(tabId, core.scrollInPage, [
        target || 'bottom', selector || '', pixels || 0, ref || '',
      ]);
      this._complete('scroll_complete', tabId, requestId, result);
    } catch (error) {
      this._fail(requestId, error, 'SCROLL_ERROR');
    }
  },

async handleWaitFor(message) {
    const { tabId, selector, timeout, visible, condition, match, ref, networkIdle, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      const mode = condition || 'selector';
      if (mode === 'selector' && !selector) throw new Error('必须提供 selector');
      if (mode === 'ref' && !ref) throw new Error('必须提供 ref');
      const timeoutSec = Number.isFinite(timeout) ? timeout : 10;
      const result = await this._runPageInteract(tabId, core.waitForInPage, [
        selector || '', timeoutSec * 1000, !!visible, mode, match || '', ref || '',
      ]);
      if (result && networkIdle && result.success && result.settledBy === 'load') {
        result.settledBy = 'load';
      }
      this._complete('wait_for_complete', tabId, requestId, result);
    } catch (error) {
      this._fail(requestId, error, 'WAIT_FOR_ERROR');
    }
  },

async handleGetPageState(message) {
    const { tabId, maxElements, interactiveOnly, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      const result = await this._runPageInteract(tabId, core.collectPageState, [
        maxElements || 300, interactiveOnly !== false,
      ]);
      this._complete('get_page_state_complete', tabId, requestId, result);
    } catch (error) {
      this._fail(requestId, error, 'PAGE_STATE_ERROR');
    }
  },

async handleSendKeys(message) {
    const { tabId, keys, ref, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      if (!keys) throw new Error('必须提供 keys');
      const result = await this._runPageInteract(tabId, core.sendKeysInPage, [keys, ref || '']);
      this._complete('send_keys_complete', tabId, requestId, result);
    } catch (error) {
      this._fail(requestId, error, 'SEND_KEYS_ERROR');
    }
  },

async handleNavigateHistory(message) {
    const { tabId, direction, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      const parsedTabId = parseInt(tabId, 10);
      const go = direction === 'forward' ? extensionApi.tabs?.goForward : extensionApi.tabs?.goBack;
      if (typeof go === 'function') {
        const maybe = go.call(extensionApi.tabs, parsedTabId);
        if (maybe && typeof maybe.then === 'function') await maybe;
        this._complete('navigate_history_complete', tabId, requestId, { success: true, direction });
        return;
      }
      const result = await this._runPageInteract(tabId, core.navigateHistoryInPage, [direction || 'back']);
      this._complete('navigate_history_complete', tabId, requestId, result);
    } catch (error) {
      this._fail(requestId, error, 'HISTORY_ERROR');
    }
  },

async handleSelectOption(message) {
    const { tabId, selector, value, label, index, ref, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      if (!selector && !ref) throw new Error('必须提供 selector 或 ref');
      const result = await this._runPageInteract(tabId, core.selectOptionInPage, [
        selector || '', value || '', label || '', index || 0, ref || '',
      ]);
      this._complete('select_option_complete', tabId, requestId, result);
    } catch (error) {
      this._fail(requestId, error, 'SELECT_ERROR');
    }
  },

async handleHandleDialog(message) {
    const error = new Error('JavaScript dialogs are not available on the extension connector');
    error.code = 'CAPABILITY_UNSUPPORTED';
    this._fail(message.requestId, error, 'CAPABILITY_UNSUPPORTED');
  },

async handleListDownloads(message) {
    try {
      if (!extensionApi.downloads || typeof extensionApi.downloads.search !== 'function') {
        const error = new Error('downloads API is unavailable');
        error.code = 'CAPABILITY_UNSUPPORTED';
        throw error;
      }
      const items = await extensionApi.downloads.search({ orderBy: ['-startTime'], limit: 50 });
      this._complete('list_downloads_complete', message.tabId, message.requestId, {
        downloads: (items || []).map(sanitizeDownload),
      });
    } catch (error) {
      this._fail(message.requestId, error, 'DOWNLOADS_ERROR');
    }
  },

async handleWaitDownload(message) {
    const { id, basename, timeout, requestId } = message;
    try {
      if (!extensionApi.downloads || typeof extensionApi.downloads.search !== 'function') {
        const error = new Error('downloads API is unavailable');
        error.code = 'CAPABILITY_UNSUPPORTED';
        throw error;
      }
      const timeoutMs = (Number.isFinite(timeout) ? timeout : 30) * 1000;
      const deadline = Date.now() + timeoutMs;
      const match = (item) => {
        if (id && String(item.id) === String(id)) return true;
        if (basename && basenameOf(item.filename) === basename) return true;
        return !id && !basename;
      };
      while (Date.now() < deadline) {
        const items = await extensionApi.downloads.search({ orderBy: ['-startTime'], limit: 50 });
        const found = (items || []).map(sanitizeDownload).find((item) => match(item) && item.state === 'complete');
        if (found) {
          this._complete('wait_download_complete', message.tabId, requestId, found);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const error = new Error('Download wait timed out');
      error.code = 'DOWNLOAD_TIMEOUT';
      throw error;
    } catch (error) {
      this._fail(requestId, error, 'DOWNLOADS_ERROR');
    }
  },

async handleDrag(message) {
    const { tabId, requestId } = message || {};
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      const result = await this._runPageInteract(tabId, core.dragInPage, [message]);
      this._complete('drag_complete', tabId, requestId, result);
    } catch (error) {
      this._fail(requestId, error, 'DRAG_ERROR');
    }
  },

async handleWheel(message) {
    const { tabId, requestId } = message || {};
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      const result = await this._runPageInteract(tabId, core.wheelInPage, [message]);
      this._complete('wheel_complete', tabId, requestId, result);
    } catch (error) {
      this._fail(requestId, error, 'WHEEL_ERROR');
    }
  },

async handleSelectText(message) {
    const { tabId, requestId } = message || {};
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      const result = await this._runPageInteract(tabId, core.selectTextInPage, [message]);
      this._complete('select_text_complete', tabId, requestId, result);
    } catch (error) {
      this._fail(requestId, error, 'SELECT_TEXT_ERROR');
    }
  },

async handleSetZoom(message) {
    const { tabId, zoomFactor, requestId } = message || {};
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      const parsedTabId = parseInt(tabId, 10);
      if (zoomFactor == null) {
        if (extensionApi.tabs && typeof extensionApi.tabs.getZoom === 'function') {
          const current = await extensionApi.tabs.getZoom(parsedTabId);
          this._complete('set_zoom_complete', tabId, requestId, { success: true, zoomFactor: current, mode: 'tabs' });
          return;
        }
        this._complete('set_zoom_complete', tabId, requestId, await this._runPageInteract(tabId, core.zoomInPage, [null]));
        return;
      }
      const factor = Number(zoomFactor) === 0 ? 1 : Number(zoomFactor);
      if (!Number.isFinite(factor) || factor < 0.25 || factor > 5) {
        const err = new Error('zoomFactor must be between 0.25 and 5 (or 0 to reset)');
        err.code = 'INVALID_ARGUMENT';
        throw err;
      }
      if (extensionApi.tabs && typeof extensionApi.tabs.setZoom === 'function') {
        await extensionApi.tabs.setZoom(parsedTabId, Number(zoomFactor) === 0 ? 0 : factor);
        const applied = typeof extensionApi.tabs.getZoom === 'function'
          ? await extensionApi.tabs.getZoom(parsedTabId)
          : factor;
        this._complete('set_zoom_complete', tabId, requestId, { success: true, zoomFactor: applied, mode: 'tabs' });
        return;
      }
      this._complete('set_zoom_complete', tabId, requestId, await this._runPageInteract(tabId, core.zoomInPage, [factor]));
    } catch (error) {
      this._fail(requestId, error, 'ZOOM_ERROR');
    }
  },

async _captureRecordingFrame(rec) {
    if (rec.stopped) return;
    if (rec.frames.length >= rec.maxFrames) {
      rec.droppedFrames += 1;
      rec.truncated = true;
      rec.stopped = true;
      return;
    }
    try {
      const tab = await extensionApi.tabs.get(rec.tabId);
      if (!tab || !tab.active) { rec.droppedFrames += 1; return; }
      const opts = rec.format === 'jpeg' ? { format: 'jpeg', quality: rec.quality } : { format: 'png' };
      const dataUrl = await extensionApi.tabs.captureVisibleTab(tab.windowId, opts);
      if (typeof dataUrl !== 'string' || !dataUrl) { rec.droppedFrames += 1; return; }
      if (rec.totalBytes + dataUrl.length > rec.maxBytes) {
        rec.droppedFrames += 1;
        rec.truncated = true;
        rec.stopped = true;
        return;
      }
      rec.width = tab.width || rec.width;
      rec.height = tab.height || rec.height;
      rec.totalBytes += dataUrl.length;
      rec.frames.push({
        index: rec.frames.length,
        timestampMs: Math.max(0, Date.now() - rec.startMono),
        dataUrl,
        width: tab.width || null,
        height: tab.height || null,
      });
    } catch {
      rec.droppedFrames += 1;
    }
  },

async handleRecordStart(message) {
    const { tabId, format, quality, fps, maxDurationSec, maxFrames, maxBytes, activate, requestId } = message || {};
    try {
      if (tabId == null) throw new Error('缺少 tabId 参数');
      if (!extensionApi.tabs || typeof extensionApi.tabs.captureVisibleTab !== 'function') {
        throw Object.assign(new Error('captureVisibleTab API is unavailable'), { code: 'CAPABILITY_UNSUPPORTED' });
      }
      if (!this._activeRecordings) this._activeRecordings = new Map();
      const parsedTabId = parseInt(tabId, 10);
      for (const existing of this._activeRecordings.values()) {
        if (existing.tabId === parsedTabId && !existing.stopped) {
          throw Object.assign(new Error('A recording is already active on this tab'), { code: 'RECORDING_ALREADY_ACTIVE' });
        }
      }
      let tab = await extensionApi.tabs.get(parsedTabId);
      if (!tab) throw new Error(`未找到 tabId=${tabId}`);
      if (activate === true && !tab.active && typeof extensionApi.tabs.update === 'function') {
        await extensionApi.tabs.update(parsedTabId, { active: true });
        tab = await extensionApi.tabs.get(parsedTabId);
      }
      if (!tab || !tab.active) {
        throw Object.assign(
          new Error('Target tab must be active to record (pass activate: true or focus the tab)'),
          { code: 'TAB_NOT_ACTIVE' },
        );
      }
      const maxCallsPerSec = Number(extensionApi.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND);
      const safeMaxFps = Number.isFinite(maxCallsPerSec) && maxCallsPerSec > 0 ? Math.max(0.5, maxCallsPerSec * 0.9) : 10;
      const effectiveFps = Math.max(0.5, Math.min(safeMaxFps, Number.isFinite(fps) && Number(fps) > 0 ? Number(fps) : safeMaxFps));
      const minIntervalMs = Number.isFinite(maxCallsPerSec) && maxCallsPerSec > 0 ? Math.ceil(1000 / maxCallsPerSec) + 50 : 100;
      const intervalMs = Math.max(minIntervalMs, Math.round(1000 / effectiveFps));
      const clampedDuration = Number.isFinite(maxDurationSec) ? Math.max(0.5, Math.min(120, Number(maxDurationSec))) : 30;
      const clampedFrames = Number.isFinite(maxFrames) ? Math.max(1, Math.min(1200, Math.round(Number(maxFrames)))) : 300;
      const clampedBytes = Number.isFinite(maxBytes) ? Math.max(65536, Math.min(67108864, Math.round(Number(maxBytes)))) : 33554432;
      const fmt = format === 'png' ? 'png' : 'jpeg';
      const qual = Number.isFinite(quality) ? Math.max(1, Math.min(100, Math.round(Number(quality)))) : 80;
      const recordingId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = new Date().toISOString();
      const rec = {
        recordingId, tabId: parsedTabId, format: fmt, quality: qual,
        effectiveFps: Math.round(effectiveFps * 100) / 100, intervalMs,
        maxDurationSec: clampedDuration, maxFrames: clampedFrames, maxBytes: clampedBytes,
        startedAt, stoppedAt: null, startMono: Date.now(), durationMs: 0,
        frames: [], totalBytes: 0, droppedFrames: 0, truncated: false,
        width: tab.width || null, height: tab.height || null,
        stopped: false, timer: null, deadlineTimer: null, inflight: null,
      };
      this._activeRecordings.set(recordingId, rec);
      rec.inflight = this._captureRecordingFrame(rec);
      await rec.inflight;
      rec.inflight = null;
      const scheduleNext = () => {
        if (rec.stopped) return;
        rec.timer = setTimeout(async () => {
          rec.timer = null;
          if (rec.stopped) return;
          rec.inflight = this._captureRecordingFrame(rec);
          await rec.inflight;
          rec.inflight = null;
          scheduleNext();
        }, rec.intervalMs);
      };
      scheduleNext();
      rec.deadlineTimer = setTimeout(() => {
        rec.truncated = true;
        rec.stopped = true;
        rec.stoppedAt = new Date().toISOString();
        rec.durationMs = Math.max(0, Date.now() - rec.startMono);
        if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
      }, Math.round(clampedDuration * 1000));
      this._complete('record_start_complete', tabId, requestId, {
        success: true, recordingId, tabId: parsedTabId, mode: 'visible_tab', format: fmt,
        effectiveFps: rec.effectiveFps, maxDurationSec: clampedDuration, maxFrames: clampedFrames, startedAt,
      });
    } catch (error) {
      this._fail(requestId, error, 'RECORD_START_ERROR');
    }
  },

async handleRecordStop(message) {
    const { tabId, recordingId, requestId } = message || {};
    try {
      const store = this._activeRecordings;
      let rec = (store && recordingId) ? store.get(String(recordingId)) : null;
      if (!rec && store && !recordingId && tabId != null) {
        const parsedTabId = parseInt(tabId, 10);
        for (const candidate of store.values()) {
          if (candidate.tabId === parsedTabId) { rec = candidate; break; }
        }
      }
      if (!rec) throw Object.assign(new Error('No active recording found'), { code: 'RECORDING_NOT_FOUND' });
      if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
      if (rec.deadlineTimer) { clearTimeout(rec.deadlineTimer); rec.deadlineTimer = null; }
      if (rec.inflight) { await rec.inflight.catch(() => {}); rec.inflight = null; }
      if (!rec.stopped) {
        const lastTs = rec.frames.length > 0 ? rec.frames[rec.frames.length - 1].timestampMs : -rec.intervalMs;
        if ((Date.now() - rec.startMono) - lastTs >= rec.intervalMs) {
          await this._captureRecordingFrame(rec);
        }
        rec.stopped = true;
        rec.stoppedAt = new Date().toISOString();
        rec.durationMs = Math.max(0, Date.now() - rec.startMono);
      }
      store.delete(rec.recordingId);
      this._complete('record_stop_complete', rec.tabId, requestId, {
        success: true, recordingId: rec.recordingId, tabId: rec.tabId, mode: 'visible_tab',
        format: rec.format, startedAt: rec.startedAt, stoppedAt: rec.stoppedAt || new Date().toISOString(),
        durationMs: rec.durationMs, frameCount: rec.frames.length, droppedFrames: rec.droppedFrames,
        truncated: rec.truncated, width: rec.width, height: rec.height, totalBytes: rec.totalBytes,
        frames: rec.frames,
      });
    } catch (error) {
      this._fail(requestId, error, 'RECORD_STOP_ERROR');
    }
  },
  };
}

const sharedMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedMethods;
}
globalThis.JSEyesPageInteractMethods = sharedMethods;
})();
