'use strict';

(() => {
function resolveExtractFn() {
  if (typeof require === 'function') {
    try {
      return require('@js-eyes/page-extract').extractPageContent;
    } catch (err) {
      try {
        return require('../../packages/page-extract').extractPageContent;
      } catch (err2) {}
    }
  }
  if (globalThis.JSEyesPageExtract && typeof globalThis.JSEyesPageExtract.extractPageContent === 'function') {
    return globalThis.JSEyesPageExtract.extractPageContent;
  }
  return globalThis.JSEyesExtractPageContent;
}

function classifyExtractError(error) {
  const code = error && error.code;
  const msg = String((error && error.message) || '');
  if (code === 'tab_not_found' || /No tab|Invalid tab|tab not found|缺少 tabId/i.test(msg)) {
    return 'tab_not_found';
  }
  if (code === 'eval_denied' || /allowRawEval|RAW_EVAL|eval is disabled/i.test(msg)) {
    return 'eval_denied';
  }
  if (code === 'csp_blocked' || /CSP|Content Security Policy|Cannot access contents|Refused to execute/i.test(msg)) {
    return 'csp_blocked';
  }
  return code || 'EXTRACT_ERROR';
}

function createMethods(extensionApi) {
  if (!extensionApi) throw new TypeError('extensionApi is required');
  const extractPageContent = resolveExtractFn();
  return {
async handleExtract(message) {
    const {
      tabId,
      requestId,
      format,
      includeLinks,
      includeImages,
      maxContentChars,
      maxLinks,
      maxImages,
    } = message;
    try {
      if (!tabId && tabId !== 0) {
        const missing = new Error('缺少 tabId 参数');
        missing.code = 'tab_not_found';
        throw missing;
      }
      if (typeof extractPageContent !== 'function') {
        throw new Error('page.extract implementation is unavailable');
      }
      const parsedTabId = parseInt(tabId, 10);
      if (extensionApi.tabs && typeof extensionApi.tabs.get === 'function') {
        try {
          await extensionApi.tabs.get(parsedTabId);
        } catch (err) {
          const missing = new Error(err && err.message ? err.message : 'tab_not_found');
          missing.code = 'tab_not_found';
          throw missing;
        }
      }
      const params = {};
      if (format !== undefined) params.format = format;
      if (includeLinks !== undefined) params.includeLinks = includeLinks;
      if (includeImages !== undefined) params.includeImages = includeImages;
      if (maxContentChars !== undefined) params.maxContentChars = maxContentChars;
      if (maxLinks !== undefined) params.maxLinks = maxLinks;
      if (maxImages !== undefined) params.maxImages = maxImages;
      const result = await this._runPageInteract(tabId, extractPageContent, [params]);
      if (result == null) {
        const blocked = new Error('page extract returned no result');
        blocked.code = 'csp_blocked';
        throw blocked;
      }
      this.sendMessage({
        type: 'extract_page_complete',
        tabId,
        result,
        requestId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('处理 extract_page 请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId,
        code: classifyExtractError(error),
      });
    }
  },
  };
}

const sharedMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedMethods;
}
globalThis.JSEyesPageExtractMethods = sharedMethods;
})();
