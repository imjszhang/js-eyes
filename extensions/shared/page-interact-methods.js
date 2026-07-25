'use strict';

(() => {
function createMethods(extensionApi) {
  if (!extensionApi) throw new TypeError('extensionApi is required');
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
      const result = await this._runPageInteract(tabId, (sel, textMatch, idx) => {
        let el;
        if (textMatch) {
          const all = document.querySelectorAll(sel || '*');
          const matches = [];
          for (let i = 0; i < all.length; i++) {
            if ((all[i].innerText || '').trim().indexOf(textMatch) !== -1) matches.push(all[i]);
          }
          el = matches[idx] || null;
        } else if (sel.startsWith('//') || sel.startsWith('(//')) {
          const xr = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          el = xr.snapshotItem(idx);
        } else {
          const all = document.querySelectorAll(sel);
          el = all[idx] || null;
        }
        if (!el) {
          return { success: false, error: '未找到匹配元素: ' + sel + (textMatch ? ' (text=' + textMatch + ')' : '') };
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return { success: true, tag: el.tagName, text: (el.innerText || '').substring(0, 100) };
      }, [selector || '*', text || '', index || 0]);
      this.sendMessage({
        type: 'click_complete',
        tabId,
        result,
        requestId,
        timestamp: new Date().toISOString(),
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
      const result = await this._runPageInteract(tabId, (sel, val, clear, idx) => {
        function summarizeFilledValue(el, filled) {
          if (el && String(el.type || '').toLowerCase() === 'password') {
            return '[redacted]';
          }
          const text = String(filled ?? '');
          return text.length > 100 ? text.substring(0, 100) : text;
        }
        const all = document.querySelectorAll(sel);
        const el = all[idx];
        if (!el) return { success: false, error: '未找到表单元素: ' + sel };
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        if (el.tagName === 'SELECT') {
          el.value = val;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, tag: 'SELECT', value: summarizeFilledValue(el, el.value) };
        }
        if (el.isContentEditable) {
          if (clear) el.innerHTML = '';
          el.innerHTML += val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true, tag: el.tagName, contentEditable: true };
        }
        if (clear) el.value = '';
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, clear ? val : el.value + val);
        } else {
          el.value = clear ? val : el.value + val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, tag: el.tagName, value: summarizeFilledValue(el, el.value) };
      }, [selector, value || '', !!clearFirst, index || 0]);
      this.sendMessage({
        type: 'fill_complete',
        tabId,
        result,
        requestId,
        timestamp: new Date().toISOString(),
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
      const result = await this._runPageInteract(tabId, (scrollTarget, sel, px) => {
        if (sel) {
          const el = document.querySelector(sel);
          if (!el) return { success: false, error: '未找到元素: ' + sel };
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return { success: true, scrolledTo: 'element', selector: sel };
        }
        if (scrollTarget === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return { success: true, scrolledTo: 'top' };
        }
        if (scrollTarget === 'bottom') {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          return { success: true, scrolledTo: 'bottom', scrollHeight: document.body.scrollHeight };
        }
        if (px) {
          window.scrollBy({ top: px, behavior: 'smooth' });
          return { success: true, scrolledTo: 'relative', pixels: px };
        }
        return { success: true, scrolledTo: scrollTarget || 'bottom' };
      }, [target || 'bottom', selector || '', pixels || 0]);
      this.sendMessage({
        type: 'scroll_complete',
        tabId,
        result,
        requestId,
        timestamp: new Date().toISOString(),
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
      const result = await this._runPageInteract(tabId, (sel, timeoutMs, needVisible) => new Promise((resolve) => {
        function check() {
          const el = document.querySelector(sel);
          if (!el) return false;
          if (needVisible) {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          return true;
        }
        if (check()) {
          resolve({ success: true, found: true, waited: 0 });
          return;
        }
        const start = Date.now();
        const observer = new MutationObserver(() => {
          if (check()) {
            observer.disconnect();
            resolve({ success: true, found: true, waited: Date.now() - start });
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        setTimeout(() => {
          observer.disconnect();
          resolve({ success: false, found: false, waited: timeoutMs, error: '等待超时: ' + sel });
        }, timeoutMs);
      }), [selector, timeoutSec * 1000, !!visible]);
      this.sendMessage({
        type: 'wait_for_complete',
        tabId,
        result,
        requestId,
        timestamp: new Date().toISOString(),
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
