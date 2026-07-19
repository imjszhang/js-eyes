'use strict';

function createMethods() {
  const { executeUserScript } = globalThis.JSEyesChromeUserScriptExecutor;
  return {
async handleOpenUrl(message) {
    const { url, tabId, windowId, requestId } = message;
    const timeout = this.securityConfig.requestTimeout || 30000;

    try {
      let resultTabId;
      let isExistingTab = false;

      if (!tabId && this.deduplicator) {
        const existingCheck = this.deduplicator.checkUrlTab(url);
        if (existingCheck.hasExisting) {
          try {
            const existingTab = await chrome.tabs.get(existingCheck.tabId);
            if (existingTab && existingTab.url === url) {
              console.log(`[OpenUrl] 使用已存在的标签页 ${existingCheck.tabId} (URL: ${url})`);
              resultTabId = existingCheck.tabId;
              isExistingTab = true;
            }
          } catch (e) {
            // 标签页不存在，继续创建新的
          }
        }
      }

      if (!resultTabId) {
        if (tabId) {
          await chrome.tabs.update(parseInt(tabId), { url: url });
          resultTabId = tabId;
        } else {
          const createProperties = { url: url };
          if (windowId) {
            createProperties.windowId = parseInt(windowId);
          }

          const tab = await chrome.tabs.create(createProperties);
          resultTabId = tab.id;

          if (this.deduplicator) {
            this.deduplicator.cacheUrlTab(url, resultTabId);
          }
        }
      }

      if (!isExistingTab) {
        await this.withTimeout(
          this.waitForTabLoad(resultTabId),
          timeout,
          '页面加载超时'
        );
      }

      const cookies = await this.withTimeout(
        this.getTabCookies(resultTabId),
        10000,
        '获取Cookies超时'
      ).catch(err => {
        console.warn('获取Cookies失败:', err.message);
        return [];
      });

      this.sendMessage({
        type: 'open_url_complete',
        tabId: resultTabId,
        url: url,
        cookies: cookies,
        isExistingTab: isExistingTab,
        requestId: requestId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('处理打开URL请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: requestId,
        code: error.message.includes('超时') ? 'TIMEOUT' : 'OPEN_URL_ERROR'
      });
    } finally {
      if (this.queueManager && requestId) {
        this.queueManager.remove(requestId);
      }
      if (this.deduplicator && requestId) {
        this.deduplicator.markCompleted(requestId);
      }
    }
  },

async handleGetHtml(message) {
    const { tabId, requestId } = message;
    const timeout = this.securityConfig.requestTimeout || 30000;

    try {
      const results = await this.withTimeout(
        chrome.scripting.executeScript({
          target: { tabId: parseInt(tabId) },
          func: () => document.documentElement.outerHTML
        }),
        timeout,
        '获取HTML超时'
      );

      const html = results[0]?.result || '';

      // 如果HTML太大，分块发送
      if (html.length > 100000) { // 100KB
        await this.sendHtmlInChunks(tabId, html, requestId);
      } else {
        this.sendMessage({
          type: 'tab_html_complete',
          tabId: tabId,
          html: html,
          requestId: requestId,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error('处理获取HTML请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: requestId,
        code: error.message.includes('超时') ? 'TIMEOUT' : 'HTML_ERROR'
      });
    } finally {
      if (this.queueManager && requestId) {
        this.queueManager.remove(requestId);
      }
      if (this.deduplicator && requestId) {
        this.deduplicator.markCompleted(requestId);
      }
    }
  },

async handleExecuteScript(message) {
    const { tabId, code, requestId } = message;
    const timeout = this.securityConfig.requestTimeout || 30000;

    if (!this.securityConfig.allowRawEval) {
      const reason = 'execute_script with raw JavaScript is disabled (security.allowRawEval=false). Use the declarative execute_action / execute_script_action tools, or opt in via host config security.allowRawEval=true — the extension will sync automatically on the next handshake.';
      console.warn('[Security] handleExecuteScript refused:', reason);
      this.sendMessage({
        type: 'error',
        message: reason,
        requestId,
        code: 'RAW_EVAL_DISABLED',
      });
      if (this.queueManager && requestId) this.queueManager.remove(requestId);
      if (this.deduplicator && requestId) this.deduplicator.markCompleted(requestId);
      return;
    }

    try {
      const results = await this.withTimeout(
        executeUserScript(tabId, code),
        timeout,
        '脚本执行超时'
      );

      this.sendMessage({
        type: 'execute_script_complete',
        tabId: tabId,
        result: results,
        requestId: requestId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('处理执行脚本请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: requestId,
        code: error.code || (error.message.includes('超时') ? 'TIMEOUT' : 'SCRIPT_ERROR')
      });
    } finally {
      if (this.queueManager && requestId) {
        this.queueManager.remove(requestId);
      }
      if (this.deduplicator && requestId) {
        this.deduplicator.markCompleted(requestId);
      }
    }
  },

async handleInjectCss(message) {
    try {
      const { tabId, css, requestId } = message;

      await chrome.scripting.insertCSS({
        target: { tabId: parseInt(tabId) },
        css: css
      });

      this.sendMessage({
        type: 'inject_css_complete',
        tabId: tabId,
        requestId: requestId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('处理注入CSS请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: message.requestId
      });
    }
  },

async handleUploadFileToTab(message) {
    try {
      const { tabId, files, targetSelector, requestId } = message;

      console.log(`开始处理文件上传请求: tabId=${tabId}, files=${files.length}个, requestId=${requestId}`);

      if (!tabId || !files || !Array.isArray(files) || files.length === 0) {
        throw new Error('缺少必要参数: tabId, files');
      }

      const fileMeta = files.map(f => ({
        base64: f.base64.replace(/^data:[^;]+;base64,/, ''),
        name: f.name,
        type: f.type || 'application/octet-stream',
      }));

      const results = await chrome.scripting.executeScript({
        target: { tabId: parseInt(tabId) },
        func: this.generateFileUploadScript,
        args: [fileMeta, targetSelector || 'input[type="file"]']
      });

      const uploadResult = results[0].result;

      if (uploadResult && uploadResult.success) {
        console.log(`文件上传成功: tabId=${tabId}, 上传了${files.length}个文件`);

        this.sendMessage({
          type: 'upload_file_to_tab_complete',
          tabId: tabId,
          uploadedFiles: uploadResult.uploadedFiles || [],
          targetSelector: targetSelector,
          message: `成功上传 ${files.length} 个文件`,
          requestId: requestId,
          timestamp: new Date().toISOString()
        });
      } else {
        throw new Error(uploadResult?.error || '文件上传失败');
      }

    } catch (error) {
      console.error('处理文件上传请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: message.requestId
      });
    }
  },

async handleCaptureScreenshot(message) {
    const { tabId, requestId, format, quality } = message || {};
    try {
      if (tabId == null) {
        throw new Error('缺少必要参数: tabId');
      }

      const tab = await chrome.tabs.get(parseInt(tabId));
      if (!tab) {
        throw new Error(`未找到 tabId=${tabId}`);
      }

      if (!tab.active) {
        this.sendMessage({
          type: 'capture_screenshot_complete',
          tabId,
          skipped: 'tab_not_active',
          windowId: tab.windowId ?? null,
          requestId,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const opts = { format: format === 'jpeg' ? 'jpeg' : 'png' };
      if (opts.format === 'jpeg' && Number.isFinite(quality)) {
        opts.quality = Math.max(0, Math.min(100, parseInt(quality)));
      }

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, opts);

      this.sendMessage({
        type: 'capture_screenshot_complete',
        tabId,
        windowId: tab.windowId ?? null,
        format: opts.format,
        dataUrl,
        width: tab.width || null,
        height: tab.height || null,
        requestId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('处理截图请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message || String(error),
        code: 'CAPTURE_SCREENSHOT_FAILED',
        requestId
      });
    }
  },

generateFileUploadScript(fileMeta, targetSelector) {
    try {
      let fileInput = document.querySelector(targetSelector);

      if (!fileInput) {
        const fallbacks = [
          'input[type="file"]',
          'input[accept*="image"]',
          'input[accept*="file"]',
          '[data-testid*="upload"] input[type="file"]',
        ];
        for (const sel of fallbacks) {
          const el = document.querySelector(sel);
          if (el) { fileInput = el; break; }
        }
      }

      if (!fileInput) {
        return { success: false, error: '未找到文件输入元素: ' + targetSelector };
      }

      const dt = new DataTransfer();

      for (const meta of fileMeta) {
        const binary = atob(meta.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const file = new File([bytes], meta.name, { type: meta.type, lastModified: Date.now() });
        dt.items.add(file);
      }

      fileInput.files = dt.files;

      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));

      const uploaded = Array.from(dt.files).map(f => ({
        name: f.name, size: f.size, type: f.type, lastModified: f.lastModified,
      }));

      return { success: true, uploadedFiles: uploaded };

    } catch (error) {
      return { success: false, error: error.message };
    }
  },
  };
}

const platformMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = platformMethods;
}
globalThis.JSEyesPlatformOperationsMethods = platformMethods;
