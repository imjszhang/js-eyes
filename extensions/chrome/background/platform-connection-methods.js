'use strict';

const EXTENSION_CONFIG = globalThis.EXTENSION_CONFIG;
const {
  RateLimiter,
  RequestDeduplicator,
  RequestQueueManager,
  HealthChecker,
} = globalThis.ExtensionUtils;

function createMethods() {
  return {
initStabilityTools() {
    // 速率限制器 - 限制每秒请求数
    const rateConfig = EXTENSION_CONFIG.SECURITY?.rateLimit || {};
    this.rateLimiter = new RateLimiter(
      rateConfig.maxRequestsPerSecond || 10,
      1000,
      rateConfig.blockDuration || 5000
    );

    // 请求去重器
    const requestTimeout = EXTENSION_CONFIG.SECURITY?.requestTimeout || 1800000;
    this.deduplicator = new RequestDeduplicator(requestTimeout);

    // 请求队列管理器
    this.queueManager = new RequestQueueManager(100, requestTimeout);

    // 健康检查器
    this.initHealthChecker();

    console.log('[BrowserControl] 稳定性工具已初始化');
  },

async discoverServer() {
    const discoveryConfig = (typeof EXTENSION_CONFIG !== 'undefined' && EXTENSION_CONFIG.DISCOVERY)
      ? EXTENSION_CONFIG.DISCOVERY
      : { enabled: true, configEndpoint: '/api/browser/config', timeout: 5000, fallbackWsFromHttp: true };

    let baseUrl = this.serverUrl || this.defaultServerUrl;

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

      const wsUrl = config.config?.websocketAddress || config.websocketAddress || config.websocket;

      this.serverCapabilities = {
        wsUrl: wsUrl || null,
        httpBaseUrl: this.httpBaseUrl
      };

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
    if (this.serverUrl && (this.serverUrl.startsWith('ws://') || this.serverUrl.startsWith('wss://'))) {
      if (!this.httpBaseUrl) {
        this.httpBaseUrl = this.serverUrl.replace(/^ws(s?):\/\//, 'http$1://');
      }
    } else {
      this.serverUrl = this.defaultServerUrls[0] || this.defaultServerUrl.replace(/^http(s?):\/\//, 'ws$1://');
      if (!this.httpBaseUrl) {
        this.httpBaseUrl = this.defaultServerUrl;
      }
    }

    this.serverCapabilities = {
      wsUrl: this.serverUrl,
      httpBaseUrl: this.httpBaseUrl
    };

    console.log('[Discovery] Fallback 配置:', {
      serverUrl: this.serverUrl,
      httpBaseUrl: this.httpBaseUrl,
      capabilities: this.serverCapabilities
    });
  },

initHealthChecker() {
    const healthConfig = { ...(EXTENSION_CONFIG.HEALTH_CHECK || { enabled: true }) };

    if (!healthConfig.enabled) {
      console.log('[BrowserControl] 健康检查已禁用');
      this.healthChecker = null;
      return;
    }

    const httpServerUrl = this.httpBaseUrl || '';

    this.healthChecker = new HealthChecker({
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
      isConnected: this.isConnected,
      serverUrl: this.serverUrl,
      httpBaseUrl: this.httpBaseUrl,
      authState: this.authState,

      healthCheck: this.healthChecker ? this.healthChecker.getStatus() : null,
      queueStatus: this.queueManager ? this.queueManager.getStatus() : null,
      rateLimitStatus: this.rateLimiter ? this.rateLimiter.getStatus() : null
    };
  },

canSendRequest() {
    if (this.healthChecker) {
      const healthCheck = this.healthChecker.canSendRequest();
      if (!healthCheck.allowed) {
        return healthCheck;
      }
    }

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
      const result = await chrome.storage.local.get(['serverUrl', 'autoConnect', 'serverToken', 'allowRawEval']);
      if (typeof result.allowRawEval === 'boolean') {
        this.securityConfig.allowRawEval = result.allowRawEval;
        this.rawEvalExplicitlySet = true;
      } else {
        this.rawEvalExplicitlySet = false;
      }

      if (result.serverUrl) {
        this.serverUrl = result.serverUrl;
        console.log('已加载用户设置的服务器地址:', this.serverUrl);
      } else {
        this.serverUrl = this.defaultServerUrl;
        console.log('使用默认服务器地址:', this.serverUrl);
      }

      if (result.autoConnect !== undefined) {
        this.autoConnect = result.autoConnect;
        console.log('自动连接设置:', this.autoConnect ? '启用' : '禁用');
      } else {
        this.autoConnect = true;
        console.log('使用默认自动连接设置: 启用');
      }

      if (result.serverToken) {
        this.serverToken = String(result.serverToken);
        console.log('已加载服务器 token（用于 2.2.0+ 本地服务鉴权）');
      } else {
        this.serverToken = null;
      }

    } catch (error) {
      console.error('加载设置时出错:', error);
      this.serverUrl = this.defaultServerUrl;
      this.autoConnect = true;
      this.serverToken = null;
    }
  },

nativeMessagingRequest(payload, { timeoutMs = 3000 } = {}) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.connectNative !== 'function') {
        reject(new Error('native-messaging-unavailable'));
        return;
      }

      let port;
      try {
        port = chrome.runtime.connectNative('com.js_eyes.native_host');
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
        const err = chrome.runtime.lastError?.message || 'native-messaging-disconnected';
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
      const connectionId = ++this._connectionCounter;
      this._currentConnectionId = connectionId;

      console.log(`[Connect#${connectionId}] 正在连接到 ${this.serverUrl}...`);

      // === 清理旧连接：解除事件绑定 + 关闭 ===
      if (this.ws) {
        console.log(`[Connect#${connectionId}] 清理旧连接`);
        this._cleanupSocket(this.ws, 1000, 'New connection initiated');
        this.ws = null;
      }

      this.stopHeartbeat();

      if (this.authTimeout) {
        clearTimeout(this.authTimeout);
        this.authTimeout = null;
      }

      this.authState = 'disconnected';

      let wsUrl = this.serverUrl;
      let wsProtocols = undefined;
      if (this.serverToken && typeof this.serverToken === 'string') {
        try {
          const u = new URL(this.serverUrl);
          u.searchParams.set('token', this.serverToken);
          wsUrl = u.toString();
        } catch (_) {
          const sep = this.serverUrl.includes('?') ? '&' : '?';
          wsUrl = `${this.serverUrl}${sep}token=${encodeURIComponent(this.serverToken)}`;
        }
        wsProtocols = [`bearer.${this.serverToken}`, 'js-eyes'];
      }
      this.ws = wsProtocols ? new WebSocket(wsUrl, wsProtocols) : new WebSocket(wsUrl);

      this.ws.onopen = () => {
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
              this.ws.close(1000, 'No auth message received');
            }
          }
        }, 60000);
      };

      this.ws.onmessage = (event) => {
        if (connectionId !== this._currentConnectionId) return;
        this.handleMessage(event.data);
      };

      this.ws.onclose = (event) => {
        if (connectionId !== this._currentConnectionId) {
          console.log(`[Connect#${connectionId}] onclose 被忽略（已被连接 #${this._currentConnectionId} 取代），code=${event.code}`);
          return;
        }

        const duration = this.connectStartTime ? Date.now() - this.connectStartTime : 0;
        console.log(`[Connect#${connectionId}] WebSocket连接已关闭: code=${event.code}, reason=${event.reason}, authState=${this.authState}, duration=${duration}ms`);
        this.isConnected = false;

        this.stopHeartbeat();

        if (this.healthChecker) {
          this.healthChecker.stop();
        }

        if (this.authTimeout) {
          clearTimeout(this.authTimeout);
          this.authTimeout = null;
        }

        this.broadcastStatusUpdate();

        // 如果是认证失败导致的关闭（4001-4010 是自定义认证错误码），不自动重连
        const isAuthError = event.code >= 4001 && event.code <= 4010;
        if (isAuthError || this.authState === 'failed') {
          console.log('认证失败，不自动重连。错误码:', event.code, event.reason);
          this.authState = 'failed';
          return;
        }

        this.authState = 'disconnected';

        // 如果启用自动连接，则尝试重连
        if (this.autoConnect && !this.isReconnecting) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (error) => {
        if (connectionId !== this._currentConnectionId) {
          console.log(`[Connect#${connectionId}] onerror 被忽略（已被连接 #${this._currentConnectionId} 取代）`);
          return;
        }

        const duration = this.connectStartTime ? Date.now() - this.connectStartTime : 0;
        console.error(`[Connect#${connectionId}] WebSocket错误: authState=${this.authState}, duration=${duration}ms`, error);
        this.isConnected = false;
        this.stopHeartbeat();

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
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }

    if (message.success) {
      console.log('认证成功');

      this.authState = 'authenticated';

      this.sendRawMessage({
        type: 'init',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent
      });

      // 立即发送一次标签页数据
      this.sendTabsData();

      // 启动应用层心跳
      this.startHeartbeat();

      // 同步服务端运行时配置
      setTimeout(() => {
        if (!this.serverConfig) {
          this.syncServerConfig();
        }
      }, 3000);

    } else {
      console.error('认证失败:', message.error);
      this.authState = 'failed';

      if (message.retryAfter) {
        console.log(`服务器建议 ${message.retryAfter} 秒后重试`);
      }

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
        console.log('[ConfigSync] 服务端未返回配置（可能是旧版本），使用默认配置');
        return;
      }

      const serverConfig = await response.json();
      console.log('[ConfigSync] 获取到服务端配置:', serverConfig);

      this.applyServerConfig(serverConfig);

    } catch (error) {
      console.warn('[ConfigSync] 配置同步失败（使用默认配置）:', error.message);
    }
  },

applyServerConfig(serverConfig) {
    if (serverConfig.request?.defaultTimeout) {
      const newTimeout = serverConfig.request.defaultTimeout;
      this.securityConfig.requestTimeout = newTimeout;

      if (this.queueManager) {
        this.queueManager.requestTimeoutMs = newTimeout;
      }

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

    if (serverConfig.resourceMonitor && this.healthChecker) {
      const monitorConfig = serverConfig.resourceMonitor;

      if (monitorConfig.warningThreshold) {
        this.healthChecker.warningThrottle = monitorConfig.warningThreshold;
      }

      console.log('[ConfigSync] 资源监控配置已更新');
    }

    this.serverConfig = serverConfig;

    console.log('[ConfigSync] 服务端配置同步完成');
    this.broadcastStatusUpdate();
  },

async reconnectWithNewSettings() {
    try {
      console.log('正在使用新设置重新连接...');

      this.stopAutoReconnect();
      this.stopHeartbeat();

      if (this.authTimeout) {
        clearTimeout(this.authTimeout);
        this.authTimeout = null;
      }

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
