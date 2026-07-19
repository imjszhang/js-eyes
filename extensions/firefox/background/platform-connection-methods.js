'use strict';

(() => {
const EXTENSION_CONFIG = globalThis.EXTENSION_CONFIG;
const ExtensionUtils = globalThis.ExtensionUtils;

function createMethods() {
  return {
initStabilityTools() {
    // 获取工具类（从 window.ExtensionUtils）
    const Utils = typeof ExtensionUtils !== 'undefined' ? ExtensionUtils : null;

    if (Utils) {
      // 速率限制器
      const rateLimitConfig = this.securityConfig.rateLimit || {};
      this.rateLimiter = new Utils.RateLimiter(
        rateLimitConfig.maxRequestsPerSecond || 10,
        1000,
        rateLimitConfig.blockDuration || 5000
      );

      // 请求去重器
      const requestTimeout = this.securityConfig.requestTimeout || 30000;
      this.deduplicator = new Utils.RequestDeduplicator(requestTimeout);

      // 请求队列管理器
      this.queueManager = new Utils.RequestQueueManager(100, requestTimeout);

      // 超时包装器函数
      this.withTimeout = Utils.withTimeout;

      // 健康检查器
      this.initHealthChecker(Utils);

      console.log('[BrowserControl] 稳定性工具已初始化');
    } else {
      console.warn('[BrowserControl] ExtensionUtils 未加载，使用降级模式');

      // 降级模式：提供基本功能
      this.rateLimiter = null;
      this.deduplicator = null;
      this.queueManager = null;
      this.healthChecker = null;
      this.withTimeout = async (promise, ms, errorMessage) => {
        // 简单的超时实现
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(errorMessage || '操作超时')), ms);
        });
        try {
          return await Promise.race([promise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutId);
        }
      };
    }

    // 启动定期清理任务
    this.startCleanupTask();
  },

async discoverServer() {
    const discoveryConfig = (typeof EXTENSION_CONFIG !== 'undefined' && EXTENSION_CONFIG.DISCOVERY)
      ? EXTENSION_CONFIG.DISCOVERY
      : { enabled: true, configEndpoint: '/api/browser/config', timeout: 5000, fallbackWsFromHttp: true };

    // 确定要探测的基础 URL
    let baseUrl = this.serverUrl || this.defaultServerUrl;

    // 如果用户配置的是 ws:// 地址，推导出 http:// 地址用于探测
    if (baseUrl.startsWith('ws://') || baseUrl.startsWith('wss://')) {
      const httpUrl = baseUrl.replace(/^ws(s?):\/\//, 'http$1://');
      this.httpBaseUrl = httpUrl;
    } else {
      this.httpBaseUrl = baseUrl;
    }

    if (!discoveryConfig.enabled) {
      console.log('[Discovery] 能力探测已禁用，使用默认配置');
      this._applyFallbackDiscovery();
      return;
    }

    const configUrl = `${this.httpBaseUrl}${discoveryConfig.configEndpoint}`;
    console.log(`[Discovery] 正在探测服务器: ${configUrl}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), discoveryConfig.timeout);

      const response = await fetch(configUrl, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const config = await response.json();
      console.log('[Discovery] 服务器配置:', config);

      // 从 config 响应中提取 WS 地址
      const wsUrl = config.config?.websocketAddress || config.websocketAddress || config.websocket;

      this.serverCapabilities = {
        wsUrl: wsUrl || null,
        httpBaseUrl: this.httpBaseUrl
      };

      // 设置 WS 地址
      if (wsUrl) {
        this.serverUrl = wsUrl;
        console.log(`[Discovery] WebSocket 地址: ${wsUrl}`);
      } else if (discoveryConfig.fallbackWsFromHttp) {
        this.serverUrl = this.httpBaseUrl.replace(/^http(s?):\/\//, 'ws$1://');
        console.log(`[Discovery] 从 HTTP 推导 WebSocket 地址: ${this.serverUrl}`);
      }

      console.log('[Discovery] 服务器能力:', this.serverCapabilities);

    } catch (error) {
      console.warn(`[Discovery] 能力探测失败: ${error.message}，使用 fallback`);
      this._applyFallbackDiscovery();
    }
  },

_applyFallbackDiscovery() {
    // 如果 serverUrl 已经是 ws:// 格式（来自 loadSettings），保持不变
    if (this.serverUrl && (this.serverUrl.startsWith('ws://') || this.serverUrl.startsWith('wss://'))) {
      // 已有 WS 地址，推导 HTTP 地址
      if (!this.httpBaseUrl) {
        this.httpBaseUrl = this.serverUrl.replace(/^ws(s?):\/\//, 'http$1://');
      }
    } else {
      // 从默认 URL 推导
      this.serverUrl = this.defaultServerUrls[0] || this.defaultServerUrl.replace(/^http(s?):\/\//, 'ws$1://');
      if (!this.httpBaseUrl) {
        this.httpBaseUrl = this.defaultServerUrl;
      }
    }

    this.serverCapabilities = {
      wsUrl: this.serverUrl,
      httpBaseUrl: this.httpBaseUrl
    };

    console.log(`[Discovery] Fallback - WS: ${this.serverUrl}, HTTP: ${this.httpBaseUrl}`);
  },

initHealthChecker(Utils) {
    if (!Utils || !Utils.HealthChecker) {
      console.warn('[BrowserControl] HealthChecker 类不可用');
      this.healthChecker = null;
      return;
    }

    // 获取健康检查配置
    const healthConfig = (typeof EXTENSION_CONFIG !== 'undefined' && EXTENSION_CONFIG.HEALTH_CHECK)
      ? { ...(EXTENSION_CONFIG.HEALTH_CHECK) }
      : { enabled: true, interval: 30000, endpoint: '/api/browser/health' };

    if (!healthConfig.enabled) {
      console.log('[BrowserControl] 健康检查已禁用');
      this.healthChecker = null;
      return;
    }

    // 使用 discoverServer() 后的 httpBaseUrl
    const httpServerUrl = this.httpBaseUrl || '';

    // 创建健康检查器实例
    this.healthChecker = new Utils.HealthChecker({
      httpServerUrl: httpServerUrl,
      endpoint: healthConfig.endpoint || '/api/browser/health',
      interval: healthConfig.interval || 30000,
      timeout: healthConfig.timeout || 5000,
      criticalCooldown: healthConfig.circuitBreaker?.criticalCooldown || 60000,
      warningThrottle: healthConfig.circuitBreaker?.warningThrottle || 0.5
    });

    // 设置状态变化回调
    this.healthChecker.onStatusChange = (newStatus, oldStatus, data) => {
      console.log(`[HealthChecker] 服务状态变化: ${oldStatus} -> ${newStatus}`, data);

      // 通知 Popup 状态变化
      this.broadcastStatusUpdate();

      // 如果状态恢复为 healthy，尝试重新连接 WebSocket
      if (newStatus === 'healthy' && oldStatus === 'critical' && !this.isConnected) {
        console.log('[HealthChecker] 服务恢复，尝试重新连接 WebSocket');
        this.connect();
      }
    };

    console.log('[BrowserControl] 健康检查器已初始化');
  },

getExtendedStatus() {
    return {
      // 连接状态
      isConnected: this.isConnected,
      serverUrl: this.serverUrl,
      httpBaseUrl: this.httpBaseUrl,

      // 健康检查状态
      healthCheck: this.healthChecker ? this.healthChecker.getStatus() : null,

      // 队列状态
      queueStatus: this.queueManager ? this.queueManager.getStatus() : null,

      // 限流状态
      rateLimitStatus: this.rateLimiter ? this.rateLimiter.getStatus() : null
    };
  },

canSendRequest() {
    // 健康检查熔断
    if (this.healthChecker) {
      const healthCheck = this.healthChecker.canSendRequest();
      if (!healthCheck.allowed) {
        return healthCheck;
      }
    }

    // 本地限流检查
    if (this.rateLimiter) {
      const rateCheck = this.rateLimiter.check();
      if (!rateCheck.allowed) {
        return rateCheck;
      }
    }

    return { allowed: true };
  },

async loadSettings() {
    try {
      const result = await browser.storage.local.get(['serverUrl', 'autoConnect', 'serverToken', 'allowRawEval']);
      if (typeof result.allowRawEval === 'boolean') {
        this.securityConfig.allowRawEval = result.allowRawEval;
        this.rawEvalExplicitlySet = true;
      } else {
        this.rawEvalExplicitlySet = false;
      }

      if (result.serverUrl) {
        // 使用用户设置的服务器地址（可能是 http:// 或 ws:// 格式）
        this.serverUrl = result.serverUrl;
        console.log('已加载用户设置的服务器地址:', this.serverUrl);
      } else {
        // 使用默认入口地址（discoverServer() 会推导出实际 WS 地址）
        this.serverUrl = this.defaultServerUrl;
        console.log('使用默认服务器地址:', this.serverUrl);
      }

      // 加载自动连接设置（默认启用）
      if (result.autoConnect !== undefined) {
        this.autoConnect = result.autoConnect;
        console.log('自动连接设置:', this.autoConnect ? '启用' : '禁用');
      } else {
        this.autoConnect = true; // 默认启用
        console.log('使用默认自动连接设置: 启用');
      }

      if (result.serverToken) {
        this.serverToken = String(result.serverToken);
        console.log('已加载服务器 token');
      } else {
        this.serverToken = null;
      }

    } catch (error) {
      console.error('加载设置时出错:', error);
      // 使用默认设置
      this.serverUrl = this.defaultServerUrl;
      this.autoConnect = true;
      this.serverToken = null;
    }
  },

nativeMessagingRequest(payload, { timeoutMs = 3000 } = {}) {
    return new Promise((resolve, reject) => {
      const runtimeApi = (typeof browser !== 'undefined' && browser.runtime)
        || (typeof chrome !== 'undefined' ? chrome.runtime : null);
      if (!runtimeApi || typeof runtimeApi.connectNative !== 'function') {
        reject(new Error('native-messaging-unavailable'));
        return;
      }

      let port;
      try {
        port = runtimeApi.connectNative('com.js_eyes.native_host');
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      const finalize = (kind, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { port.disconnect(); } catch {}
        if (kind === 'ok') resolve(value); else reject(value);
      };

      const timer = setTimeout(() => finalize('err', new Error('native-messaging-timeout')), timeoutMs);

      port.onMessage.addListener((message) => finalize('ok', message));
      port.onDisconnect.addListener(() => {
        const err = runtimeApi.lastError?.message || 'native-messaging-disconnected';
        finalize('err', new Error(err));
      });

      try {
        port.postMessage(payload);
      } catch (error) {
        finalize('err', error);
      }
    });
  },

connect() {
    // === 防重入保护：500ms 内的重复调用只执行最后一次 ===
    if (this._connectDebounceTimer) {
      clearTimeout(this._connectDebounceTimer);
    }
    this._connectDebounceTimer = setTimeout(() => {
      this._connectDebounceTimer = null;
    }, 500);

    try {
      // 生成唯一连接 ID，用于识别当前连接实例
      const connectionId = ++this._connectionCounter;
      this._currentConnectionId = connectionId;

      console.log(`[Connect#${connectionId}] 正在连接到 ${this.serverUrl}...`);

      // === 清理旧连接：解除事件绑定 + 关闭 ===
      if (this.ws) {
        console.log(`[Connect#${connectionId}] 清理旧连接`);
        this._cleanupSocket(this.ws, 1000, 'New connection initiated');
        this.ws = null;
      }

      // 停止心跳（属于旧连接）
      this.stopHeartbeat();

      // 清除认证超时（属于旧连接）
      if (this.authTimeout) {
        clearTimeout(this.authTimeout);
        this.authTimeout = null;
      }

      // 重置认证状态
      this.authState = 'disconnected';

      const wsProtocols = this.serverToken && typeof this.serverToken === 'string'
        ? [`bearer.${this.serverToken}`, 'js-eyes']
        : undefined;
      this.ws = wsProtocols
        ? new WebSocket(this.serverUrl, wsProtocols)
        : new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        // === 连接实例检查：如果不是当前连接，忽略事件 ===
        if (connectionId !== this._currentConnectionId) {
          console.log(`[Connect#${connectionId}] onopen 被忽略（已被连接 #${this._currentConnectionId} 取代）`);
          return;
        }

        console.log(`[Connect#${connectionId}] WebSocket连接已建立，等待服务器认证结果...`);
        this.isConnected = true;
        this.isReconnecting = false;
        this.authState = 'authenticating';
        this.connectStartTime = Date.now();

        // 重置重连计数器
        this.resetReconnectCounter();

        // 清除重连定时器
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        // 启动健康检查
        if (this.healthChecker) {
          this.healthChecker.start();
        }

        // 广播状态更新
        this.broadcastStatusUpdate();

        // 安全网超时：60s 后若仍无 auth_result，关闭连接
        this.authTimeout = setTimeout(() => {
          if (connectionId !== this._currentConnectionId) return;

          if (this.authState === 'authenticating') {
            console.error('[Auth] 服务器连接后 60 秒无认证结果，关闭连接');
            if (this.ws) {
              this.ws.close(1000, 'No auth result received');
            }
          }
        }, 60000);
      };

      this.ws.onmessage = (event) => {
        // === 连接实例检查 ===
        if (connectionId !== this._currentConnectionId) return;
        this.handleMessage(event.data);
      };

      this.ws.onclose = (event) => {
        // === 连接实例检查：核心防护，阻止孤儿连接的 onclose 破坏新连接状态 ===
        if (connectionId !== this._currentConnectionId) {
          console.log(`[Connect#${connectionId}] onclose 被忽略（已被连接 #${this._currentConnectionId} 取代），code=${event.code}`);
          return;
        }

        const duration = this.connectStartTime ? Date.now() - this.connectStartTime : 0;
        console.log(`[Connect#${connectionId}] WebSocket连接已关闭: code=${event.code}, reason=${event.reason}, authState=${this.authState}, duration=${duration}ms`);
        this.isConnected = false;

        // 停止应用层心跳
        this.stopHeartbeat();

        // 停止健康检查器，避免与重连逻辑竞争
        if (this.healthChecker) {
          this.healthChecker.stop();
        }

        // 清除认证超时
        if (this.authTimeout) {
          clearTimeout(this.authTimeout);
          this.authTimeout = null;
        }

        // 广播状态更新
        this.broadcastStatusUpdate();

        // 如果是认证失败导致的关闭（4001-4010 是自定义认证错误码），不自动重连
        const isAuthError = event.code >= 4001 && event.code <= 4010;
        if (isAuthError || this.authState === 'failed') {
          console.log('认证失败，不自动重连。错误码:', event.code, event.reason);
          this.authState = 'failed';
          return;
        }

        // 重置认证状态
        this.authState = 'disconnected';

        // 如果启用自动连接，则尝试重连
        if (this.autoConnect && !this.isReconnecting) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (error) => {
        // === 连接实例检查 ===
        if (connectionId !== this._currentConnectionId) {
          console.log(`[Connect#${connectionId}] onerror 被忽略（已被连接 #${this._currentConnectionId} 取代）`);
          return;
        }

        const duration = this.connectStartTime ? Date.now() - this.connectStartTime : 0;
        console.error(`[Connect#${connectionId}] WebSocket错误: authState=${this.authState}, duration=${duration}ms`, error);
        this.isConnected = false;
        this.stopHeartbeat();

        // 停止健康检查器，避免与重连逻辑竞争
        if (this.healthChecker) {
          this.healthChecker.stop();
        }

        // 如果启用自动连接，则尝试重连
        if (this.autoConnect && !this.isReconnecting) {
          this.attemptReconnect();
        }
      };

    } catch (error) {
      console.error('连接WebSocket时出错:', error);
      this.isConnected = false;

      // 如果启用自动连接，则尝试重连
      if (this.autoConnect && !this.isReconnecting) {
        this.attemptReconnect();
      }
    }
  },

handleAuthResult(message) {
    // 清除认证超时
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }

    if (message.success) {
      console.log('认证成功!', { permissions: message.permissions });

      this.authState = 'authenticated';

      // 发送初始化消息
      this.sendRawMessage({
        type: 'init',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent
      });

      // 立即发送一次标签页数据
      this.sendTabsData();

      // 启动应用层心跳
      this.startHeartbeat();

      // 从 HTTP 配置端点同步限流等参数（后备）
      setTimeout(() => {
        if (!this.serverConfig) {
          this.syncServerConfig();
        }
      }, 3000);

    } else {
      console.error('认证失败:', message.error);
      this.authState = 'failed';

      // 记录重试时间
      if (message.retryAfter) {
        console.log(`服务器建议 ${message.retryAfter} 秒后重试`);
      }

      // 关闭连接
      if (this.ws) {
        this.ws.close(4004, '认证失败');
      }
    }
  },

async syncServerConfig() {
    try {
      const httpServerUrl = this.httpBaseUrl || '';
      if (!httpServerUrl) {
        console.log('[ConfigSync] httpBaseUrl 未设置，跳过配置同步');
        return;
      }

      const configUrl = `${httpServerUrl}/api/browser/config`;

      console.log('[ConfigSync] 正在从服务端获取配置...');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(configUrl, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // 服务端可能不支持配置端点（旧版本），使用默认配置
        console.log('[ConfigSync] 服务端未返回配置（可能是旧版本），使用默认配置');
        return;
      }

      const serverConfig = await response.json();
      console.log('[ConfigSync] 获取到服务端配置:', serverConfig);

      // 应用服务端配置
      this.applyServerConfig(serverConfig);

    } catch (error) {
      // 配置同步失败不影响正常功能
      console.warn('[ConfigSync] 配置同步失败（使用默认配置）:', error.message);
    }
  },

applyServerConfig(serverConfig) {
    // 同步超时配置
    if (serverConfig.request?.defaultTimeout) {
      const newTimeout = serverConfig.request.defaultTimeout;
      this.securityConfig.requestTimeout = newTimeout;

      // 更新队列管理器的超时设置
      if (this.queueManager) {
        this.queueManager.requestTimeoutMs = newTimeout;
      }

      // 更新去重器的过期时间
      if (this.deduplicator) {
        this.deduplicator.expirationMs = newTimeout;
      }

      console.log(`[ConfigSync] 请求超时已更新: ${newTimeout}ms`);
    }

    if (serverConfig.security && typeof serverConfig.security.allowRawEval === 'boolean') {
      if (this.rawEvalExplicitlySet) {
        console.log(
          `[ConfigSync] Host allowRawEval=${serverConfig.security.allowRawEval}, but extension storage override is active (allowRawEval=${this.securityConfig.allowRawEval})`
        );
      } else {
        this.securityConfig.allowRawEval = serverConfig.security.allowRawEval;
        console.log(`[ConfigSync] allowRawEval synced from host: ${serverConfig.security.allowRawEval}`);
      }
    }

    // 同步限流配置：优先使用 extensionRateLimit（扩展命令处理专用），
    // 不再使用 callbackQueryLimit（那是 HTTP 回调查询限流，不适用于扩展命令处理）
    if (serverConfig.extensionRateLimit) {
      if (this.rateLimiter && serverConfig.extensionRateLimit.maxRequestsPerSecond) {
        this.rateLimiter.maxRequests = serverConfig.extensionRateLimit.maxRequestsPerSecond;
        console.log(`[ConfigSync] 限流已更新: ${this.rateLimiter.maxRequests} 次/秒`);
      }
      if (this.rateLimiter && serverConfig.extensionRateLimit.blockDuration) {
        this.rateLimiter.blockDuration = serverConfig.extensionRateLimit.blockDuration;
      }
    }

    // 同步资源监控阈值
    if (serverConfig.resourceMonitor && this.healthChecker) {
      const monitorConfig = serverConfig.resourceMonitor;

      if (monitorConfig.warningThreshold) {
        this.healthChecker.warningThrottle = monitorConfig.warningThreshold;
      }

      console.log('[ConfigSync] 资源监控配置已更新');
    }

    // 保存同步的配置供参考
    this.serverConfig = serverConfig;

    console.log('[ConfigSync] 服务端配置同步完成');

    // 广播状态更新
    this.broadcastStatusUpdate();
  },

async reconnectWithNewSettings() {
    try {
      console.log('正在使用新设置重新连接...');

      // 停止当前的重连尝试
      this.stopAutoReconnect();

      // 停止心跳（属于旧连接）
      this.stopHeartbeat();

      // 清除认证超时（属于旧连接）
      if (this.authTimeout) {
        clearTimeout(this.authTimeout);
        this.authTimeout = null;
      }

      // 显式清理旧连接：解除所有事件绑定后关闭，防止异步 onclose 干扰新连接
      if (this.ws) {
        this._cleanupSocket(this.ws, 1000, 'Reconnecting with new settings');
        this.ws = null;
      }

      this.isConnected = false;
      this.reconnectAttempts = 0;

      // 重新加载设置
      await this.loadSettings();

      // 重新进行能力探测
      await this.discoverServer();

      // 更新健康检查器的地址
      if (this.healthChecker && this.httpBaseUrl) {
        this.healthChecker.updateConfig({ httpServerUrl: this.httpBaseUrl });
      }

      // 重新连接（不受自动连接设置影响，这是手动触发）
      this.connect();

    } catch (error) {
      console.error('重新连接时出错:', error);
    }
  },
  };
}

const platformMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = platformMethods;
}
globalThis.JSEyesPlatformConnectionMethods = platformMethods;
})();
