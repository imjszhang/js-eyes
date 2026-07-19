'use strict';

function createMethods() {
  return {
async handleMessage(data) {
    try {
      const message = JSON.parse(data);
      console.log('收到服务器消息:', message.type, message);

      if (message && (message.status === 'pending-egress'
          || message.code === 'POLICY_SOFT_BLOCK'
          || message.code === 'POLICY_PENDING_EGRESS')) {
        console.warn('[Policy] 忽略被规则引擎拦截的消息:', message.code || message.status, message.rule || '');
        return;
      }

      switch (message.type) {
        case 'auth_result':
          this.handleAuthResult(message);
          return;

        case 'response':
          await this.handleServerResponse(message);
          return;

        case 'init_ack':
          console.log('收到 init_ack:', message.status);
          if (message.serverConfig) {
            this.applyServerConfig(message.serverConfig);
          }
          this.broadcastStatusUpdate();
          return;

        case 'pong':
          this.lastPongTime = Date.now();
          return;

        case 'error':
          console.warn('[ServerError]', message.code, message.message);
          break;
      }

      if (this.authState === 'authenticating') {
        console.warn('认证中，暂时忽略业务消息:', message.type);
        return;
      }

      const actionType = message.action || message.type;
      const payload = message.payload || message;
      const requestId = payload.requestId || message.requestId;

      // === 保护层检查 ===

      if (this.rateLimiter) {
        const rateLimitResult = this.rateLimiter.check();
        if (!rateLimitResult.allowed) {
          console.warn(`[RateLimit] 请求被限制: ${actionType}`, rateLimitResult.reason);
          this.sendMessage({
            type: 'error',
            message: rateLimitResult.reason,
            requestId: requestId,
            code: 'RATE_LIMITED',
            retryAfter: rateLimitResult.retryAfter
          });
          return;
        }
      }

      if (this.deduplicator && requestId) {
        const dedupResult = this.deduplicator.checkRequest(requestId);
        if (dedupResult.isDuplicate) {
          console.warn(`[Dedup] 重复请求被跳过: ${requestId}`);
          return;
        }
        this.deduplicator.markProcessing(requestId);
      }

      if (this.queueManager && requestId) {
        const queueResult = this.queueManager.add(requestId, actionType, { tabId: payload.tabId });
        if (!queueResult.accepted) {
          console.warn(`[Queue] 队列已满，请求被拒绝: ${requestId}`);
          this.sendMessage({
            type: 'error',
            message: queueResult.reason,
            requestId: requestId,
            code: 'QUEUE_FULL',
            queueSize: queueResult.queueSize
          });
          if (this.deduplicator) {
            this.deduplicator.markCompleted(requestId);
          }
          return;
        }
      }

      switch (actionType) {
        case 'open_url':
          await this.handleOpenUrl(payload);
          break;

        case 'close_tab':
          await this.handleCloseTab(payload);
          break;

        case 'get_html':
          await this.handleGetHtml(payload);
          break;

        case 'execute_script':
          await this.handleExecuteScript(payload);
          break;

        case 'inject_css':
          await this.handleInjectCss(payload);
          break;

        case 'get_cookies':
          await this.handleGetCookies(payload);
          break;

        case 'get_cookies_by_domain':
          await this.handleGetCookiesByDomain(payload);
          break;

        case 'get_page_info':
          await this.handleGetPageInfo(payload);
          break;

        case 'upload_file_to_tab':
          await this.handleUploadFileToTab(payload);
          break;

        case 'capture_screenshot':
          await this.handleCaptureScreenshot(payload);
          break;

        case 'subscribe_events':
          await this.handleSubscribeEvents(payload);
          break;

        case 'unsubscribe_events':
          await this.handleUnsubscribeEvents(payload);
          break;

        default:
          console.warn('未知消息类型:', actionType);
          if (this.queueManager && requestId) {
            this.queueManager.remove(requestId);
          }
          if (this.deduplicator && requestId) {
            this.deduplicator.markCompleted(requestId);
          }
          break;
      }
    } catch (error) {
      console.error('处理服务器消息时出错:', error);
    }
  },

async handleServerResponse(message) {
    const { requestId, status, data, error, retryAfter, deduplicated, existingRequestId } = message;

    // 处理请求去重响应
    if (deduplicated && existingRequestId) {
      console.log(`[ServerResponse] 请求 ${requestId} 被去重，使用已有请求 ${existingRequestId}`);
      if (this.pendingRequests.has(requestId)) {
        const callback = this.pendingRequests.get(requestId);
        this.pendingRequests.delete(requestId);
        if (!this.pendingRequests.has(existingRequestId)) {
          this.pendingRequests.set(existingRequestId, callback);
        }
      }
      return;
    }

    // 根据状态处理
    switch (status) {
      case 'pending':
        console.log(`[ServerResponse] 请求 ${requestId} 已注册，等待处理`);
        break;

      case 'processing':
        console.log(`[ServerResponse] 请求 ${requestId} 正在处理中`);
        break;

      case 'completed':
        console.log(`[ServerResponse] 请求 ${requestId} 成功完成:`, data);
        this.resolveRequest(requestId, { status, data });
        break;

      case 'timeout':
        console.warn(`[ServerResponse] 请求 ${requestId} 服务端超时`);
        this.resolveRequest(requestId, {
          status: 'timeout',
          error: error || '服务端请求超时（60秒）'
        });
        break;

      case 'rate_limited':
        console.warn(`[ServerResponse] 请求 ${requestId} 触发服务端限流，${retryAfter} 秒后重试`);
        this.handleServerRateLimit(retryAfter);
        this.resolveRequest(requestId, {
          status: 'rate_limited',
          error: `服务端限流，请 ${retryAfter} 秒后重试`,
          retryAfter
        });
        break;

      case 'error':
        console.error(`[ServerResponse] 请求 ${requestId} 失败:`, error);

        if (error === 'AUTH_REQUIRED' || error === 'AUTH_FAILED') {
          console.log('认证失效，需要重新连接');
          this.authState = 'disconnected';
          this.reconnectWithNewSettings();
        }

        this.resolveRequest(requestId, { status: 'error', error });
        break;

      default:
        console.log(`[ServerResponse] 请求 ${requestId} 状态: ${status}`, data);
        this.resolveRequest(requestId, { status, data, error });
    }
  },

handleServerRateLimit(retryAfter) {
    const waitMs = (retryAfter || 5) * 1000;

    if (this.rateLimiter) {
      this.rateLimiter.blockedUntil = Date.now() + waitMs;
      console.log(`[RateLimit] 服务端限流，本地限流器已同步，${retryAfter} 秒后解除`);
    }

    this.broadcastStatusUpdate();
  },
  };
}

const platformMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = platformMethods;
}
globalThis.JSEyesPlatformServerMethods = platformMethods;
