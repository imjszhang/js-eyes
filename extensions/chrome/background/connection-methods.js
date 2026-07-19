'use strict';

function createMethods(extensionApi) {
  if (!extensionApi) throw new TypeError('extensionApi is required');
  return {
startCleanupTask() {
    setInterval(() => {
      try {
        if (this.deduplicator) {
          this.deduplicator.cleanup();
        }
        if (this.queueManager) {
          const expiredRequests = this.queueManager.cleanupExpired();
          // 为过期的请求发送超时响应
          for (const expired of expiredRequests) {
            this.sendMessage({
              type: 'error',
              message: `请求超时: ${expired.type}`,
              requestId: expired.requestId,
              code: 'TIMEOUT'
            });
          }
        }
      } catch (error) {
        console.error('[CleanupTask] 清理任务出错:', error);
      }
    }, 10000); // 每 10 秒执行一次
  },

broadcastStatusUpdate() {
    try {
      extensionApi.runtime.sendMessage({
        type: 'STATUS_UPDATE',
        data: this.getExtendedStatus()
      }).catch(() => {
        // Popup 可能未打开，忽略错误
      });
    } catch (e) {
      // 忽略
    }
  },

async saveServerToken(token) {
    try {
      const value = token && String(token).trim();
      if (!value) {
        await extensionApi.storage.local.remove('serverToken');
        this.serverToken = null;
        console.log('服务器 token 已清除');
      } else {
        await extensionApi.storage.local.set({ serverToken: value });
        this.serverToken = value;
        console.log('服务器 token 已保存');
      }
      if (this.isConnected) {
        this.reconnectWithNewSettings();
      }
    } catch (error) {
      console.error('保存服务器 token 失败:', error);
      throw error;
    }
  },

async trySyncFromNativeHost({ silent = false } = {}) {
    try {
      const response = await this.nativeMessagingRequest({ type: 'get-config' }, { timeoutMs: 3000 });
      if (!response || response.ok !== true) {
        if (!silent) console.warn('[native-host] get-config 未返回 token:', response?.error || 'unknown');
        return { ok: false, reason: response?.error || 'no-token' };
      }
      if (response.serverToken) {
        await this.saveServerToken(response.serverToken);
      }
      if (response.httpUrl) {
        if (!this.serverUrl || this.serverUrl === this.defaultServerUrl) {
          this.serverUrl = response.httpUrl;
          try {
            await extensionApi.storage.local.set({ serverUrl: response.httpUrl });
          } catch {}
        }
      }
      if (!silent) console.log('[native-host] 同步完成');
      return { ok: true };
    } catch (error) {
      if (!silent) console.warn('[native-host] 同步失败:', error?.message || error);
      return { ok: false, reason: error?.message || 'error' };
    }
  },

_cleanupSocket(ws, code = 1000, reason = '') {
    if (!ws) return;
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(code, reason);
      }
    } catch (e) {
      console.warn('[BrowserControl] 清理旧连接时出错:', e.message);
    }
  },

startHeartbeat() {
    this.stopHeartbeat();
    this.lastPongTime = Date.now();

    this.heartbeatTimer = setInterval(() => {
      if (!this.isConnected || this.ws.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }

      // 检查是否有 pong 响应
      const timeSinceLastPong = Date.now() - this.lastPongTime;
      const maxMissTime = this.heartbeatIntervalMs * this.heartbeatMissThreshold;

      if (timeSinceLastPong > maxMissTime) {
        console.warn(`[Heartbeat] 心跳超时: ${timeSinceLastPong}ms 未收到 pong（阈值: ${maxMissTime}ms），关闭连接`);
        this.stopHeartbeat();
        if (this.ws) {
          this.ws.close(1000, 'Heartbeat timeout');
        }
        return;
      }

      // 发送 ping
      this.sendRawMessage({
        type: 'ping',
        timestamp: new Date().toISOString()
      });
    }, this.heartbeatIntervalMs);

    console.log(`[Heartbeat] 已启动应用层心跳 (间隔: ${this.heartbeatIntervalMs}ms)`);
  },

stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  },

attemptReconnect() {
    // 如果已经在重连或未启用自动连接，则返回
    if (this.isReconnecting || !this.autoConnect) {
      return;
    }

    // 如果认证失败，不自动重连（需要用户检查密钥）
    if (this.authState === 'failed') {
      console.log('认证失败状态，跳过自动重连。请检查认证密钥配置。');
      // 广播状态更新，让用户知道需要检查认证
      this.broadcastStatusUpdate();
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // 计算延迟时间（指数退避，最大60秒）
    // 2s → 4s → 8s → 16s → 32s → 60s（之后保持60s）
    const baseDelay = 2000; // 2秒
    const maxDelay = 60000; // 60秒
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts - 1), maxDelay);

    // 添加 ±25% 的随机抖动，避免多客户端同时重连（thundering herd 问题）
    const jitterFactor = 0.25;
    const jitter = exponentialDelay * (Math.random() * jitterFactor * 2 - jitterFactor);
    const delay = Math.round(exponentialDelay + jitter);

    console.log(`准备在第 ${this.reconnectAttempts} 次尝试重连，延迟 ${delay}ms（基础: ${exponentialDelay}ms, 抖动: ${Math.round(jitter)}ms）...`);

    // 设置重连定时器
    this.reconnectTimer = setTimeout(() => {
      if (this.autoConnect && !this.isConnected) {
        console.log(`正在尝试第 ${this.reconnectAttempts} 次重连...`);
        this.isReconnecting = false;
        this.connect();
      } else {
        this.isReconnecting = false;
      }
    }, delay);
  },

resetReconnectCounter() {
    this.reconnectAttempts = 0;
    console.log('[Reconnect] 重连计数器已重置');
  },

stopAutoReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    console.log('已停止自动重连');
  },
  };
}

const sharedMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedMethods;
}
globalThis.JSEyesConnectionMethods = sharedMethods;
