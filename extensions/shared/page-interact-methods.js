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

function createMethods(extensionApi) {
  if (!extensionApi) throw new TypeError('extensionApi is required');
  const core = resolveInteractCore();
  return {
async _runPageInteract(tabId, func, args) {
    const parsedTabId = parseInt(tabId, 10);
    // Chrome MV3 / modern Firefox: structured func+args (never user-supplied source).
    if (extensionApi.scripting && typeof extensionApi.scripting.executeScript === 'function') {
      const results = await extensionApi.scripting.executeScript({
        target: { tabId: parsedTabId },
        func,
        args,
      });
      return results && results[0] ? results[0].result : null;
    }
    // Firefox MV2 fallback: serialize the extension-owned function only.
    if (extensionApi.tabs && typeof extensionApi.tabs.executeScript === 'function') {
      const results = await extensionApi.tabs.executeScript(parsedTabId, {
        code: `(${func.toString()}).apply(null, ${JSON.stringify(args)})`,
      });
      return Array.isArray(results) ? results[0] : null;
    }
    throw new Error('Browser scripting API is unavailable');
  },

async handleClick(message) {
    const { tabId, selector, text, index, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      if (!selector && !text) throw new Error('必须提供 selector 或 text');
      const result = await this._runPageInteract(tabId, core.clickInPage, [selector || '*', text || '', index || 0]);
      this.sendMessage({
        type: 'click_complete',
        tabId,
        result,
        requestId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('处理 click 请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId,
        code: error.code || 'CLICK_ERROR',
      });
    }
  },

async handleFill(message) {
    const { tabId, selector, value, clearFirst, index, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      if (!selector) throw new Error('必须提供 selector');
      const result = await this._runPageInteract(tabId, core.fillInPage, [selector, value || '', !!clearFirst, index || 0]);
      this.sendMessage({
        type: 'fill_complete',
        tabId,
        result,
        requestId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('处理 fill 请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId,
        code: error.code || 'FILL_ERROR',
      });
    }
  },

async handleScroll(message) {
    const { tabId, target, selector, pixels, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      const result = await this._runPageInteract(tabId, core.scrollInPage, [target || 'bottom', selector || '', pixels || 0]);
      this.sendMessage({
        type: 'scroll_complete',
        tabId,
        result,
        requestId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('处理 scroll 请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId,
        code: error.code || 'SCROLL_ERROR',
      });
    }
  },

async handleWaitFor(message) {
    const { tabId, selector, timeout, visible, requestId } = message;
    try {
      if (!tabId) throw new Error('缺少 tabId 参数');
      if (!selector) throw new Error('必须提供 selector');
      const timeoutSec = Number.isFinite(timeout) ? timeout : 10;
      const result = await this._runPageInteract(tabId, core.waitForInPage, [selector, timeoutSec * 1000, !!visible]);
      this.sendMessage({
        type: 'wait_for_complete',
        tabId,
        result,
        requestId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('处理 wait_for 请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId,
        code: error.code || 'WAIT_FOR_ERROR',
      });
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
