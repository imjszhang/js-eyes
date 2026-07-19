/**
 * Browser Control Extension - Background Script (Chrome Manifest V3)
 * 
 * 负责与 JS Eyes 服务器的 WebSocket 通信
 * 处理标签页管理、内容获取、脚本执行等功能
 * 
 * 安全特性：
 * - 实现扩展中转通信模式
 * - 验证来自 Content Script 的请求
 * - 敏感操作权限验证
 */

import '../config.js';
import './utils.js';
import './browser-control-methods.js';

const EXTENSION_CONFIG = globalThis.EXTENSION_CONFIG;
const {
  withTimeout,
  RateLimiter,
  RequestDeduplicator,
  RequestQueueManager,
  HealthChecker,
} = globalThis.ExtensionUtils;
class BrowserControl {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    
    // 默认服务器入口地址
    this.defaultServerUrl = (typeof EXTENSION_CONFIG !== 'undefined' && EXTENSION_CONFIG.SERVER_URL)
      ? EXTENSION_CONFIG.SERVER_URL
      : 'http://localhost:18080';

    // fallback WS 地址列表
    this.defaultServerUrls = (typeof EXTENSION_CONFIG !== 'undefined' && EXTENSION_CONFIG.WEBSOCKET_SERVER_URLS) 
      ? EXTENSION_CONFIG.WEBSOCKET_SERVER_URLS 
      : ['ws://localhost:18080'];
    
    this.serverUrls = [...this.defaultServerUrls];
    this.currentServerIndex = 0;
    this.serverUrl = null; // WS 地址，由 discoverServer() 或 loadSettings 设置
    this.httpBaseUrl = null; // HTTP 基础地址，由 discoverServer() 设置
    this.serverCapabilities = null; // 服务器能力标记
    
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;
    this.pendingRequests = new Map();
    
    // 自动连接相关
    this.autoConnect = true; // 默认启用自动连接
    this.reconnectTimer = null; // 重连定时器
    this.isReconnecting = false; // 是否正在重连
    
    // 安全配置 —— 兜底保持与文件顶部 EXTENSION_CONFIG.SECURITY 一致
    this.securityConfig = EXTENSION_CONFIG.SECURITY || {
      allowedActions: [
        'get_tabs', 'get_html', 'open_url', 'close_tab',
        'execute_script', 'get_cookies', 'get_cookies_by_domain', 'inject_css',
        'get_page_info', 'upload_file_to_tab',
        'subscribe_events', 'unsubscribe_events',
        'capture_screenshot'
      ],
      sensitiveActions: ['execute_script', 'get_cookies', 'get_cookies_by_domain'],
      allowRawEval: false,
      requestTimeout: 1800000
    };

    this.rawEvalExplicitlySet = false;
    
    // 认证相关属性
    this.authState = 'disconnected'; // disconnected | authenticating | authenticated | failed
    this.authTimeout = null;         // 认证超时定时器
    
    // 应用层心跳相关
    this.heartbeatTimer = null;      // 心跳定时器
    this.lastPongTime = null;        // 上次收到 pong 的时间
    this.heartbeatIntervalMs = 25000; // 心跳间隔 25 秒
    this.heartbeatMissThreshold = 2; // 连续丢失多少次 pong 后断开
    this.connectStartTime = null;    // 连接建立时间（用于诊断）
    
    // 标签页数据防抖
    this.tabDataDebounceTimer = null;
    this.tabDataDebounceMs = 500;    // 防抖间隔 500ms
    
    // 连接实例追踪（防止孤儿连接干扰）
    this._connectionCounter = 0;
    this._currentConnectionId = 0;
    this._connectDebounceTimer = null;
    
    // 稳定性工具
    this.rateLimiter = null;
    this.deduplicator = null;
    this.queueManager = null;
    this.healthChecker = null;
    this.withTimeout = withTimeout;
    
    // 事件订阅
    this.subscribedEvents = new Set();
    
    // 初始化
    this.init();
  }

  /**
   * 初始化扩展
   */
  async init() {
    console.log('Browser Control Extension 正在初始化...');
    
    // 清理遗留的 HMAC 认证密钥（已不再使用）
    try {
      await chrome.storage.local.remove(['auth_secret_key']);
    } catch (_) { /* ignore */ }
    
    // 加载用户设置
    await this.loadSettings();

    // 尝试从本机 Native Messaging host 同步 token / 服务地址
    await this.trySyncFromNativeHost({ silent: true });

    // 能力探测：获取服务器配置，确定 WS 地址和 HTTP 地址
    await this.discoverServer();
    
    // 初始化稳定性工具（需要 httpBaseUrl，必须在 discoverServer 之后）
    this.initStabilityTools();
    
    // 设置标签页事件监听
    this.setupTabListeners();
    
    // 设置消息监听
    this.setupMessageListeners();
    
    // 定期发送标签页数据（仅在连接时发送）
    this.startTabDataSync();
    
    // 启动定期清理任务
    this.startCleanupTask();
    
    // 如果启用自动连接，则自动连接
    if (this.autoConnect) {
      console.log('自动连接已启用，正在连接...');
      this.connect();
    } else {
      console.log('扩展初始化完成 - 等待手动连接');
    }
  }
  
  /**
   * 初始化稳定性工具
   */
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
  }

  /**
   * 能力探测：请求服务器配置端点，确定 WS/HTTP 地址和服务器能力
   * 
   * 支持两种服务器：
   * - js-eyes/server (轻量版): HTTP+WS 共用端口, 无认证, 无 SSE
   * - deepseek-cowork browser (完整版): WS 独立端口, 可选认证, 有 SSE
   */
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
  }

  /**
   * 探测失败时的 fallback 逻辑
   */
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
  }
  
  /**
   * 初始化健康检查器
   */
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
  }
  
  /**
   * 启动定期清理任务
   * 每 10 秒清理过期请求和缓存
   */
  
  /**
   * 广播状态更新到 Popup
   */
  
  /**
   * 获取扩展状态（包含健康检查等新信息）
   */
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
  }
  
  /**
   * 检查是否可以发送请求（综合熔断和限流检查）
   */
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
  }

  /**
   * 加载用户设置
   */
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
  }


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
  }


  /**
   * 清理指定的 WebSocket 连接
   * 解除所有事件绑定并关闭连接，防止孤儿连接事件干扰新连接
   * @param {WebSocket} ws - 要清理的 WebSocket 实例
   * @param {number} [code=1000] - 关闭代码
   * @param {string} [reason=''] - 关闭原因
   */

  /**
   * 连接到WebSocket服务器
   * 
   * 使用连接实例追踪（connectionId）确保：
   * - 旧连接的异步事件（onclose/onerror）不会干扰新连接的状态
   * - 不会因为并发调用产生多个活跃连接（孤儿连接）
   */
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
  }

  /**
   * 处理服务器认证结果
   * @param {Object} message - 认证结果消息
   */
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
  }

  /**
   * 启动应用层心跳
   * 定期发送 ping 消息，检测连接是否存活
   */

  /**
   * 停止应用层心跳
   */

  /**
   * 发送原始消息到服务器
   */

  /**
   * 发送消息到服务器（兼容旧调用点）
   */

  /**
   * 生成唯一请求ID
   */

  /**
   * 处理来自服务器的消息
   */
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
  }

  /**
   * 处理服务器响应消息（新协议）
   * 支持服务端 v2.0 新增的状态：
   * - pending: 请求已注册，等待处理
   * - processing: 请求正在处理中
   * - completed: 请求成功完成
   * - timeout: 请求超时（服务端 60 秒超时）
   * - error: 请求发生错误
   * - rate_limited: 触发服务端限流
   */
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
  }
  
  /**
   * 解析请求并执行回调
   */
  
  /**
   * 处理服务端限流信号
   */
  handleServerRateLimit(retryAfter) {
    const waitMs = (retryAfter || 5) * 1000;
    
    if (this.rateLimiter) {
      this.rateLimiter.blockedUntil = Date.now() + waitMs;
      console.log(`[RateLimit] 服务端限流，本地限流器已同步，${retryAfter} 秒后解除`);
    }
    
    this.broadcastStatusUpdate();
  }
  
  /**
   * 从服务端同步配置
   */
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
  }
  
  /**
   * 应用服务端配置到本地
   * @param {Object} serverConfig - 服务端配置
   */
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
  }

  /**
   * 处理打开URL请求
   * 带超时保护和标签页去重
   */
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
  }

  /**
   * 处理关闭标签页请求
   */

  /**
   * 处理获取HTML请求
   * 带超时保护
   */
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
  }

  /**
   * 分块发送HTML内容
   */

  /**
   * 处理执行脚本请求
   * 带超时保护
   */
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
      const executeCode = async function(scriptCode) {
        try {
          const result = eval(scriptCode);
          if (result && typeof result.then === 'function') {
            return await result;
          }
          return result;
        } catch (error) {
          throw new Error('脚本执行错误: ' + error.message);
        }
      };
      
      const results = await this.withTimeout(
        chrome.scripting.executeScript({
          target: { tabId: parseInt(tabId) },
          func: executeCode,
          args: [code]
        }),
        timeout,
        '脚本执行超时'
      );
      
      this.sendMessage({
        type: 'execute_script_complete',
        tabId: tabId,
        result: results[0]?.result,
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
      if (this.queueManager && requestId) {
        this.queueManager.remove(requestId);
      }
      if (this.deduplicator && requestId) {
        this.deduplicator.markCompleted(requestId);
      }
    }
  }

  /**
   * 处理注入CSS请求
   */
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
  }

  /**
   * 处理获取Cookies请求
   * 注意：cookies将被发送到服务器存储在独立的cookies表中（不再关联特定tab_id）
   */

  /**
   * 处理按域名获取Cookies请求（不需要tabId，直接从浏览器获取）
   */

  /**
   * 处理获取页面信息请求（通过 WebSocket 从服务器转发）
   */

  /**
   * 按域名获取cookies（直接从浏览器获取，不需要tabId）
   * @param {string} domain 域名，如 "xiaohongshu.com"
   * @param {boolean} includeSubdomains 是否包含子域名
   * @returns {Promise<Array>} cookies数组
   */

  /**
   * 获取标签页的cookies（增强版 - 获取所有相关域名的cookies，优化错误处理）
   */

  /**
   * Cookie去重处理
   */

  /**
   * Cookie数据验证和清理
   */

  /**
   * 分析cookie域名分布
   */

  /**
   * 处理文件上传到标签页请求
   */
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
  }

  /**
   * 处理截图请求（chrome.tabs.captureVisibleTab）
   *
   * 受 Chrome 扩展 API 限制，captureVisibleTab 只能截当前激活的 tab；非激活 tab
   * 直接返回 { skipped: 'tab_not_active' }，由调用方决定是否回退。
   *
   * 该接口被设计为 fire-and-forget 的旁路:
   * - 用于 visual-bridge-kit 的 captureFrame 钩子产出 frames/<ts>.png
   * - 失败时返回 error 但不中断主调用链
   */
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
  }

  /**
   * 注入到页面中执行的文件上传脚本。
   * 使用 DataTransfer API 构造 FileList 赋给 input.files。
   */
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
  }

  /**
   * 等待标签页加载完成
   */

  /**
   * 防抖发送标签页数据
   * 合并短时间内的多次标签页变化事件为一次发送
   */

  /**
   * 设置标签页事件监听
   */

  /**
   * 设置消息监听
   */
  setupMessageListeners() {
    // 监听来自popup和content script的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // 处理来自 Content Script 的安全中转请求
      if (message.type === 'CONTENT_SCRIPT_REQUEST') {
        // 安全验证：验证发送者是否为本扩展
        if (sender.id !== chrome.runtime.id) {
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
        return true;
      }
      
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
  }

  /**
   * 处理来自 Content Script 的请求
   * 这是安全中转通信的核心处理方法
   * 
   * @param {Object} message 请求消息
   * @param {Object} sender 发送者信息
   * @returns {Promise<Object>} 响应对象
   */

  /**
   * 验证敏感操作
   * 
   * @param {string} action 操作名称
   * @param {Object} sender 发送者信息
   * @param {Object} payload 请求载荷
   * @returns {Promise<boolean>} 是否允许操作
   */
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
      }
    }
    
    return true;
  }

  /**
   * 处理获取标签页列表请求
   */

  /**
   * 处理获取HTML请求（通过 Content Script 中转）
   */
  async handleGetHtmlRequest(payload) {
    try {
      const tabId = payload?.tabId;
      if (!tabId) {
        return { success: false, error: '缺少 tabId 参数' };
      }
      
      const results = await chrome.scripting.executeScript({
        target: { tabId: parseInt(tabId) },
        func: () => document.documentElement.outerHTML
      });
      
      return { 
        success: true, 
        data: { html: results[0]?.result || '' }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 处理打开URL请求（通过 Content Script 中转）
   */

  /**
   * 处理关闭标签页请求（通过 Content Script 中转）
   */

  /**
   * 处理执行脚本请求（通过 Content Script 中转）
   * 带超时保护
   */
  async handleExecuteScriptRequest(payload, sender) {
    const timeout = this.securityConfig.requestTimeout || 30000;

    if (!this.securityConfig.allowRawEval) {
      return {
        success: false,
        error: 'execute_script with raw JavaScript is disabled (security.allowRawEval=false). Use declarative execute_action, or opt in via host config security.allowRawEval=true — the extension will sync automatically on the next handshake.',
        code: 'RAW_EVAL_DISABLED',
      };
    }

    try {
      const { tabId, code } = payload || {};
      
      if (!code) {
        return { success: false, error: '缺少 code 参数' };
      }
      
      const targetTabId = tabId ? parseInt(tabId) : sender.tab?.id;
      
      if (!targetTabId) {
        return { success: false, error: '无法确定目标标签页' };
      }
      
      const executeCode = async function(scriptCode) {
        try {
          const result = eval(scriptCode);
          if (result && typeof result.then === 'function') {
            return await result;
          }
          return result;
        } catch (error) {
          throw new Error('脚本执行错误: ' + error.message);
        }
      };
      
      const results = await this.withTimeout(
        chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: executeCode,
          args: [code]
        }),
        timeout,
        '脚本执行超时'
      );
      
      return { 
        success: true, 
        data: { result: results[0]?.result, tabId: targetTabId }
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        code: error.message.includes('超时') ? 'TIMEOUT' : 'SCRIPT_ERROR'
      };
    }
  }

  /**
   * 处理获取Cookies请求（通过 Content Script 中转）
   */

  /**
   * 处理按域名获取Cookies请求（通过 Content Script 中转）
   */

  /**
   * 处理注入CSS请求（通过 Content Script 中转）
   */
  async handleInjectCssRequest(payload) {
    try {
      const { tabId, css } = payload || {};
      
      if (!tabId || !css) {
        return { success: false, error: '缺少 tabId 或 css 参数' };
      }
      
      await chrome.scripting.insertCSS({
        target: { tabId: parseInt(tabId) },
        css: css
      });
      
      return { 
        success: true, 
        data: { tabId: parseInt(tabId), injected: true }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 处理获取页面信息请求（通过 Content Script 中转）
   */

  /**
   * 处理文件上传请求（通过 Content Script 中转）
   */
  async handleUploadFileRequest(payload) {
    try {
      const { tabId, files, targetSelector } = payload || {};
      
      if (!tabId || !files || !Array.isArray(files)) {
        return { success: false, error: '缺少必要参数' };
      }
      
      // 复用现有的文件上传处理逻辑
      const results = await chrome.scripting.executeScript({
        target: { tabId: parseInt(tabId) },
        func: this.generateFileUploadScript,
        args: [targetSelector || 'input[type="file"]']
      });
      
      const uploadResult = results[0]?.result;
      
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
  }

  /**
   * 尝试自动重连（无限重试，使用指数退避 + 抖动）
   * 
   * 重连策略：
   * - 指数退避：2s → 4s → 8s → 16s → 32s → 60s（最大）
   * - 随机抖动：±25% 的随机偏移，避免多客户端同时重连
   * - 无限重试：持续尝试直到连接成功或手动停止
   * - 认证失败保护：认证失败后不自动重连，需要用户检查密钥
   */

  /**
   * 重置重连计数器
   * 在成功连接后调用，为下次断开做准备
   */

  /**
   * 停止自动重连
   */
  
  /**
   * 处理事件订阅请求
   */
  async handleSubscribeEvents(message) {
    try {
      const { events = [], requestId } = message;
      
      events.forEach(eventType => {
        this.subscribedEvents.add(eventType);
        console.log(`[SubscribeEvents] 已订阅事件: ${eventType}`);
      });
      
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
      if (this.queueManager && message.requestId) {
        this.queueManager.remove(message.requestId);
      }
      if (this.deduplicator && message.requestId) {
        this.deduplicator.markCompleted(message.requestId);
      }
    }
  }

  /**
   * 处理取消事件订阅请求
   */
  async handleUnsubscribeEvents(message) {
    try {
      const { events = [], requestId } = message;
      
      events.forEach(eventType => {
        this.subscribedEvents.delete(eventType);
        console.log(`[UnsubscribeEvents] 已取消订阅事件: ${eventType}`);
      });
      
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
      if (this.queueManager && message.requestId) {
        this.queueManager.remove(message.requestId);
      }
      if (this.deduplicator && message.requestId) {
        this.deduplicator.markCompleted(message.requestId);
      }
    }
  }

  /**
   * 使用新设置重新连接
   * 
   * 注意：旧连接的事件处理器必须被显式解除绑定，
   * 因为 ws.close() 是异步的，旧 socket 的 onclose 会在新连接建立后触发，
   * 可能错误地将 isConnected 设为 false 或触发额外重连。
   */
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
  }

  /**
   * 开始标签页数据同步
   */

  /**
   * 发送标签页数据
   */
  async sendTabsData() {
    try {
      if (!this.isConnected) return;
      
      const tabs = await chrome.tabs.query({});
      const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const tabsData = tabs.map(tab => ({
        id: tab.id.toString(),
        url: tab.url || '',
        title: tab.title || '',
        is_active: activeTab.length > 0 && activeTab[0].id === tab.id,
        window_id: tab.windowId.toString(),
        index_in_window: tab.index,
        favicon_url: tab.favIconUrl || null,
        status: tab.status || 'complete'
      }));
      
      this.sendRawMessage({
        type: 'data',
        payload: {
          tabs: tabsData,
          active_tab_id: activeTab.length > 0 ? activeTab[0].id.toString() : null
        },
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('发送标签页数据时出错:', error);
    }
  }
}

Object.assign(
  BrowserControl.prototype,
  globalThis.JSEyesSharedBrowserControl.createMethods(chrome),
);

// 初始化扩展
let browserControl = null;

// Service Worker 启动时初始化
chrome.runtime.onStartup.addListener(() => {
  console.log('Service Worker 启动');
  browserControl = new BrowserControl();
});

// 扩展安装或更新时初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('扩展已安装/更新');
  if (!browserControl) {
    browserControl = new BrowserControl();
  }
});

// 确保在 Service Worker 激活时也初始化
if (!browserControl) {
  browserControl = new BrowserControl();
}
