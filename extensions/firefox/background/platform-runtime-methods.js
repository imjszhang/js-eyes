'use strict';

(() => {
function createMethods() {
  return {
setupMessageListeners() {
    // 监听来自popup和content script的消息
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // 处理来自 Content Script 的安全中转请求
      if (message.type === 'CONTENT_SCRIPT_REQUEST') {
        // 安全验证：验证发送者是否为本扩展
        if (sender.id !== browser.runtime.id) {
          console.warn('[Background] 拒绝非法发送者的请求:', sender.id);
          sendResponse({ success: false, error: '非法发送者' });
          return true;
        }

        console.log(`[Background] 收到 Content Script 请求: ${message.action}`, {
          requestId: message.requestId,
          sourceUrl: message.sourceUrl,
          tabId: sender.tab?.id
        });

        // 处理请求（异步）
        this.handleContentScriptRequest(message, sender)
          .then(response => {
            console.log(`[Background] 请求处理完成: ${message.requestId}`, response.success);
            sendResponse(response);
          })
          .catch(error => {
            console.error(`[Background] 请求处理失败: ${message.requestId}`, error);
            sendResponse({ success: false, error: error.message });
          });

        return true; // 保持消息通道开放（异步响应）
      }

      // 原有的 popup 消息处理
      if (message.type === 'get_connection_status') {
        sendResponse({
          isConnected: this.isConnected,
          serverUrl: this.serverUrl,
          reconnectAttempts: this.reconnectAttempts
        });
        return true; // 保持消息通道开放
      }

      // 获取扩展状态（包含健康检查、限流等新信息）
      if (message.type === 'get_extended_status') {
        sendResponse(this.getExtendedStatus());
        return true;
      }

      if (message.type === 'get_server_token') {
        sendResponse({ hasServerToken: !!this.serverToken });
        return true;
      }
      if (message.type === 'save_server_token') {
        this.saveServerToken(message.token)
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
      }
      if (message.type === 'clear_server_token') {
        this.saveServerToken(null)
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
      }
      if (message.type === 'sync_token_from_native') {
        this.trySyncFromNativeHost({ silent: false })
          .then((result) => sendResponse({ success: !!result.ok, reason: result.reason || null }))
          .catch((error) => sendResponse({ success: false, reason: error.message }));
        return true;
      }
      if (message.type === 'send_tabs_data') {
        this.sendTabsData();
        sendResponse({ success: true });
        return true;
      }
      if (message.type === 'reconnect') {
        this.reconnectWithNewSettings();
        sendResponse({ success: true });
        return true;
      }
      if (message.type === 'get_auto_connect') {
        sendResponse({ autoConnect: this.autoConnect });
        return true;
      }
      if (message.type === 'set_auto_connect') {
        this.autoConnect = message.autoConnect;
        if (!this.autoConnect) {
          // 如果关闭自动连接，停止当前重连
          this.stopAutoReconnect();
        } else if (!this.isConnected && !this.isReconnecting) {
          // 如果启用自动连接且未连接，立即尝试连接
          this.connect();
        }
        sendResponse({ success: true });
        return true;
      }
    });
  },

async validateSensitiveOperation(action, sender, payload) {
    // 检查请求来源 Tab 是否有权操作目标 Tab
    if (payload && payload.tabId && sender.tab) {
      const targetTabId = parseInt(payload.tabId);
      const sourceTabId = sender.tab.id;

      if (targetTabId !== sourceTabId) {
        console.warn(`[Background] 跨Tab敏感操作: ${action}`, {
          sourceTab: sourceTabId,
          targetTab: targetTabId,
          sourceUrl: sender.tab.url
        });
        // 目前允许跨Tab操作，但记录日志以便审计
        // 如果需要更严格的安全策略，可以在这里返回 false
      }
    }

    return true;
  },

async handleGetHtmlRequest(payload) {
    try {
      const tabId = payload?.tabId;
      if (!tabId) {
        return { success: false, error: '缺少 tabId 参数' };
      }

      const results = await browser.tabs.executeScript(parseInt(tabId), {
        code: 'document.documentElement.outerHTML'
      });

      return {
        success: true,
        data: { html: results[0] || '' }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

async handleExecuteScriptRequest(payload, sender) {
    const timeout = this.securityConfig.requestTimeout || 30000;

    if (!this.securityConfig.allowRawEval) {
      return {
        success: false,
        error: 'execute_script raw eval is disabled (security.allowRawEval=false). Opt in via host config security.allowRawEval=true — the extension will sync automatically on the next handshake.',
        code: 'RAW_EVAL_DISABLED',
      };
    }

    try {
      const { tabId, code } = payload || {};

      if (!code) {
        return { success: false, error: '缺少 code 参数' };
      }

      // 如果没有指定 tabId，使用发送者的 tabId
      const targetTabId = tabId ? parseInt(tabId) : sender.tab?.id;

      if (!targetTabId) {
        return { success: false, error: '无法确定目标标签页' };
      }

      // 包装代码以支持 Promise 等待
      const wrappedCode = `
        (async function() {
          try {
            const result = eval(${JSON.stringify(code)});
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
        browser.tabs.executeScript(targetTabId, { code: wrappedCode }),
        timeout,
        `脚本执行超时`
      );

      return {
        success: true,
        data: { result: results[0], tabId: targetTabId }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.message.includes('超时') ? 'TIMEOUT' : 'SCRIPT_ERROR'
      };
    }
  },

async handleInjectCssRequest(payload) {
    try {
      const { tabId, css } = payload || {};

      if (!tabId || !css) {
        return { success: false, error: '缺少 tabId 或 css 参数' };
      }

      await browser.tabs.insertCSS(parseInt(tabId), {
        code: css
      });

      return {
        success: true,
        data: { tabId: parseInt(tabId), injected: true }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

async handleUploadFileRequest(payload) {
    try {
      const { tabId, files, targetSelector } = payload || {};

      if (!tabId || !files || !Array.isArray(files)) {
        return { success: false, error: '缺少必要参数' };
      }

      // 复用现有的文件上传处理逻辑
      const uploadScript = this.generateFileUploadScript(files, targetSelector || 'input[type="file"]');

      const results = await browser.tabs.executeScript(parseInt(tabId), {
        code: uploadScript
      });

      const uploadResult = results[0];

      if (uploadResult && uploadResult.success) {
        return {
          success: true,
          data: uploadResult
        };
      } else {
        return {
          success: false,
          error: uploadResult?.error || '文件上传失败'
        };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

async handleSubscribeEvents(message) {
    try {
      const { events = [], requestId } = message;

      // 初始化事件订阅存储
      if (!this.subscribedEvents) {
        this.subscribedEvents = new Set();
      }

      // 添加订阅的事件类型
      events.forEach(eventType => {
        this.subscribedEvents.add(eventType);
        console.log(`[SubscribeEvents] 已订阅事件: ${eventType}`);
      });

      // 发送订阅成功响应
      this.sendMessage({
        type: 'subscribe_events_response',
        requestId: requestId,
        status: 'success',
        subscribedEvents: Array.from(this.subscribedEvents),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('处理事件订阅请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: message.requestId
      });
    } finally {
      // 从队列中移除请求
      if (this.queueManager && message.requestId) {
        this.queueManager.remove(message.requestId);
      }
      if (this.deduplicator && message.requestId) {
        this.deduplicator.markCompleted(message.requestId);
      }
    }
  },

async handleUnsubscribeEvents(message) {
    try {
      const { events = [], requestId } = message;

      // 如果没有订阅存储，初始化
      if (!this.subscribedEvents) {
        this.subscribedEvents = new Set();
      }

      // 移除订阅的事件类型
      events.forEach(eventType => {
        this.subscribedEvents.delete(eventType);
        console.log(`[UnsubscribeEvents] 已取消订阅事件: ${eventType}`);
      });

      // 发送取消订阅成功响应
      this.sendMessage({
        type: 'unsubscribe_events_response',
        requestId: requestId,
        status: 'success',
        unsubscribedEvents: events,
        remainingSubscriptions: Array.from(this.subscribedEvents),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('处理取消事件订阅请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: message.requestId
      });
    } finally {
      // 从队列中移除请求
      if (this.queueManager && message.requestId) {
        this.queueManager.remove(message.requestId);
      }
      if (this.deduplicator && message.requestId) {
        this.deduplicator.markCompleted(message.requestId);
      }
    }
  },
  };
}

const platformMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = platformMethods;
}
globalThis.JSEyesPlatformRuntimeMethods = platformMethods;
})();
