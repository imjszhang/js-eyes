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
  };
}

const sharedMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedMethods;
}
globalThis.JSEyesPageInteractMethods = sharedMethods;
})();
