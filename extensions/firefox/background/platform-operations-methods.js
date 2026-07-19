'use strict';

function createMethods() {
  return {
async handleOpenUrl(message) {
    const { url, tabId, windowId, requestId } = message;
    const timeout = this.securityConfig.requestTimeout || 30000;

    try {
      let resultTabId;
      let isExistingTab = false;

      // 如果没有指定 tabId，检查是否已有相同 URL 的标签页（去重）
      if (!tabId && this.deduplicator) {
        const existingCheck = this.deduplicator.checkUrlTab(url);
        if (existingCheck.hasExisting) {
          // 验证标签页是否仍然存在
          try {
            const existingTab = await browser.tabs.get(existingCheck.tabId);
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
          // 更新现有标签页
          await browser.tabs.update(parseInt(tabId), { url: url });
          resultTabId = tabId;
        } else {
          // 创建新标签页
          const createProperties = { url: url };
          if (windowId) {
            createProperties.windowId = parseInt(windowId);
          }

          const tab = await browser.tabs.create(createProperties);
          resultTabId = tab.id;

          // 缓存 URL 与标签页的映射
          if (this.deduplicator) {
            this.deduplicator.cacheUrlTab(url, resultTabId);
          }
        }
      }

      // 等待页面加载完成（带超时）
      if (!isExistingTab) {
        await this.withTimeout(
          this.waitForTabLoad(resultTabId),
          timeout,
          `页面加载超时`
        );
      }

      // 获取cookies（带超时）
      const cookies = await this.withTimeout(
        this.getTabCookies(resultTabId),
        10000, // cookies 获取使用较短的超时
        `获取Cookies超时`
      ).catch(err => {
        console.warn('获取Cookies失败:', err.message);
        return []; // cookies 获取失败不影响主流程
      });

      // 发送完成响应
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
      // 从队列中移除请求
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
      // 使用超时包装器获取 HTML
      const results = await this.withTimeout(
        browser.tabs.executeScript(parseInt(tabId), {
          code: 'document.documentElement.outerHTML'
        }),
        timeout,
        `获取HTML超时`
      );

      const html = results[0] || '';

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
      // 从队列中移除请求
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
      const reason = 'execute_script with raw JavaScript is disabled (security.allowRawEval=false). Opt in via host config security.allowRawEval=true — the extension will sync automatically on the next handshake.';
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
      // 包装代码以支持 Promise 等待
      const wrappedCode = `
        (async function() {
          try {
            const result = eval(${JSON.stringify(code)});
            // 检测返回值是否为 Promise（thenable），如果是则等待
            if (result && typeof result.then === 'function') {
              return await result;
            }
            return result;
          } catch (error) {
            throw new Error('脚本执行错误: ' + error.message);
          }
        })();
      `;

      // 使用超时包装器执行脚本
      const results = await this.withTimeout(
        browser.tabs.executeScript(parseInt(tabId), { code: wrappedCode }),
        timeout,
        `脚本执行超时`
      );

      this.sendMessage({
        type: 'execute_script_complete',
        tabId: tabId,
        result: results[0],
        requestId: requestId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('处理执行脚本请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: requestId,
        code: error.message.includes('超时') ? 'TIMEOUT' : 'SCRIPT_ERROR'
      });
    } finally {
      // 从队列中移除请求
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

      await browser.tabs.insertCSS(parseInt(tabId), {
        code: css
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

      const uploadScript = this.generateFileUploadScript(fileMeta, targetSelector || 'input[type="file"]');

      const results = await browser.tabs.executeScript(parseInt(tabId), {
        code: uploadScript
      });

      const uploadResult = results[0];

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
    const { tabId, requestId, format, quality, fullPage } = message || {};
    try {
      if (tabId == null) {
        throw new Error('缺少必要参数: tabId');
      }

      const tab = await browser.tabs.get(parseInt(tabId));
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

      if (fullPage === true) {
        const shot = await this.captureFullPageScreenshot(tab, opts);
        this.sendMessage({
          type: 'capture_screenshot_complete',
          tabId,
          windowId: tab.windowId ?? null,
          format: shot.format,
          dataUrl: shot.dataUrl,
          width: shot.width,
          height: shot.height,
          fullPage: true,
          pageWidth: shot.pageWidth,
          pageHeight: shot.pageHeight,
          viewportWidth: shot.viewportWidth,
          viewportHeight: shot.viewportHeight,
          devicePixelRatio: shot.devicePixelRatio,
          segments: shot.segments,
          requestId,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, opts);

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

async captureFullPageScreenshot(tab, opts) {
    const tabId = parseInt(tab.id);
    const metrics = await this.getScreenshotPageMetrics(tabId);
    const viewportWidth = Math.max(1, Math.floor(metrics.viewportWidth || tab.width || 1));
    const viewportHeight = Math.max(1, Math.floor(metrics.viewportHeight || tab.height || 1));
    const pageWidth = Math.max(viewportWidth, Math.ceil(metrics.pageWidth || viewportWidth));
    const pageHeight = Math.max(viewportHeight, Math.ceil(metrics.pageHeight || viewportHeight));
    const maxScrollX = Math.max(0, pageWidth - viewportWidth);
    const maxScrollY = Math.max(0, pageHeight - viewportHeight);
    const columns = Math.ceil(pageWidth / viewportWidth);
    const rows = Math.ceil(pageHeight / viewportHeight);
    const maxSegments = 80;

    if (columns * rows > maxSegments) {
      throw new Error(`页面过大，长截图需要 ${columns * rows} 个分片，超过上限 ${maxSegments}`);
    }

    const captures = [];
    let scaleX = null;
    let scaleY = null;

    try {
      for (let row = 0; row < rows; row++) {
        const logicalTop = row * viewportHeight;
        const targetY = Math.min(logicalTop, maxScrollY);
        for (let col = 0; col < columns; col++) {
          const logicalLeft = col * viewportWidth;
          const targetX = Math.min(logicalLeft, maxScrollX);
          const scroll = await this.scrollScreenshotTabTo(tabId, targetX, targetY);
          await this.delay(180);

          const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, opts);
          const image = await this.loadScreenshotImage(dataUrl);
          if (!scaleX || !scaleY) {
            scaleX = image.width / viewportWidth;
            scaleY = image.height / viewportHeight;
          }

          const sourceOffsetX = Math.max(0, logicalLeft - (scroll.x || targetX));
          const sourceOffsetY = Math.max(0, logicalTop - (scroll.y || targetY));
          const cropWidthCss = Math.min(viewportWidth - sourceOffsetX, pageWidth - logicalLeft);
          const cropHeightCss = Math.min(viewportHeight - sourceOffsetY, pageHeight - logicalTop);

          captures.push({
            image,
            sourceOffsetX,
            sourceOffsetY,
            cropWidthCss,
            cropHeightCss,
            destX: logicalLeft,
            destY: logicalTop,
          });
        }
      }

      const outputWidth = Math.ceil(pageWidth * scaleX);
      const outputHeight = Math.ceil(pageHeight * scaleY);
      const maxCanvasDimension = 32767;
      const maxCanvasPixels = 160000000;
      if (outputWidth > maxCanvasDimension || outputHeight > maxCanvasDimension || outputWidth * outputHeight > maxCanvasPixels) {
        throw new Error(`页面过大，拼接画布 ${outputWidth}x${outputHeight} 超过安全上限`);
      }

      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');
      for (const capture of captures) {
        ctx.drawImage(
          capture.image,
          Math.round(capture.sourceOffsetX * scaleX),
          Math.round(capture.sourceOffsetY * scaleY),
          Math.round(capture.cropWidthCss * scaleX),
          Math.round(capture.cropHeightCss * scaleY),
          Math.round(capture.destX * scaleX),
          Math.round(capture.destY * scaleY),
          Math.round(capture.cropWidthCss * scaleX),
          Math.round(capture.cropHeightCss * scaleY)
        );
      }

      const mime = opts.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const quality = opts.format === 'jpeg' && Number.isFinite(opts.quality)
        ? Math.max(0, Math.min(1, opts.quality / 100))
        : undefined;

      return {
        dataUrl: quality === undefined ? canvas.toDataURL(mime) : canvas.toDataURL(mime, quality),
        format: opts.format,
        width: outputWidth,
        height: outputHeight,
        pageWidth,
        pageHeight,
        viewportWidth,
        viewportHeight,
        devicePixelRatio: metrics.devicePixelRatio || null,
        segments: captures.map((capture, index) => ({
          index,
          x: capture.destX,
          y: capture.destY,
          width: capture.cropWidthCss,
          height: capture.cropHeightCss,
        })),
      };
    } finally {
      await this.scrollScreenshotTabTo(tabId, metrics.scrollX || 0, metrics.scrollY || 0).catch(() => {});
    }
  },

async getScreenshotPageMetrics(tabId) {
    const code = `
(function() {
  var doc = document.documentElement || {};
  var body = document.body || {};
  var viewportWidth = window.innerWidth || doc.clientWidth || body.clientWidth || 1;
  var viewportHeight = window.innerHeight || doc.clientHeight || body.clientHeight || 1;
  var pageWidth = Math.max(
    doc.scrollWidth || 0, body.scrollWidth || 0,
    doc.offsetWidth || 0, body.offsetWidth || 0,
    viewportWidth
  );
  var pageHeight = Math.max(
    doc.scrollHeight || 0, body.scrollHeight || 0,
    doc.offsetHeight || 0, body.offsetHeight || 0,
    viewportHeight
  );
  return {
    viewportWidth: viewportWidth,
    viewportHeight: viewportHeight,
    pageWidth: pageWidth,
    pageHeight: pageHeight,
    scrollX: window.scrollX || window.pageXOffset || 0,
    scrollY: window.scrollY || window.pageYOffset || 0,
    devicePixelRatio: window.devicePixelRatio || 1
  };
})();
`;
    const results = await browser.tabs.executeScript(tabId, { code });
    return results && results[0] ? results[0] : {};
  },

async scrollScreenshotTabTo(tabId, x, y) {
    const code = `
(function() {
  window.scrollTo(${Math.max(0, Math.floor(x))}, ${Math.max(0, Math.floor(y))});
  return {
    x: window.scrollX || window.pageXOffset || 0,
    y: window.scrollY || window.pageYOffset || 0
  };
})();
`;
    const results = await browser.tabs.executeScript(tabId, { code });
    return results && results[0] ? results[0] : { x, y };
  },

loadScreenshotImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('截图分片解码失败'));
      image.src = dataUrl;
    });
  },

delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

generateFileUploadScript(fileMeta, targetSelector) {
    const escapedSelector = targetSelector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const filesJson = JSON.stringify(fileMeta);
    return `
(function() {
  try {
    var targetSelector = '${escapedSelector}';
    var fileMeta = ${filesJson};
    var fileInput = document.querySelector(targetSelector);
    if (!fileInput) {
      var fallbacks = ['input[type="file"]', 'input[accept*="image"]', 'input[accept*="file"]'];
      for (var i = 0; i < fallbacks.length; i++) {
        var el = document.querySelector(fallbacks[i]);
        if (el) { fileInput = el; break; }
      }
    }
    if (!fileInput) {
      return { success: false, error: '未找到文件输入元素: ' + targetSelector };
    }
    var dt = new DataTransfer();
    for (var i = 0; i < fileMeta.length; i++) {
      var meta = fileMeta[i];
      var binary = atob(meta.base64);
      var bytes = new Uint8Array(binary.length);
      for (var j = 0; j < binary.length; j++) { bytes[j] = binary.charCodeAt(j); }
      var file = new File([bytes], meta.name, { type: meta.type, lastModified: Date.now() });
      dt.items.add(file);
    }
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    var uploaded = Array.from(dt.files).map(function(f) {
      return { name: f.name, size: f.size, type: f.type, lastModified: f.lastModified };
    });
    return { success: true, uploadedFiles: uploaded };
  } catch (error) {
    return { success: false, error: error.message };
  }
})();
`;
  },
  };
}

const platformMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = platformMethods;
}
globalThis.JSEyesPlatformOperationsMethods = platformMethods;
