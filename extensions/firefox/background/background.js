/**
 * Browser Control Extension - Background Script
 * 
 * 负责与 JS Eyes 服务器的 WebSocket 通信
 * 处理标签页管理、内容获取、脚本执行等功能
 * 
 * 安全特性：
 * - 实现扩展中转通信模式
 * - 验证来自 Content Script 的请求
 * - 敏感操作权限验证
 */

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
    
    // 安全配置
    this.securityConfig = (typeof EXTENSION_CONFIG !== 'undefined' && EXTENSION_CONFIG.SECURITY) 
      ? EXTENSION_CONFIG.SECURITY 
      : {
          allowedActions: [
            'get_tabs', 'get_html', 'open_url', 'close_tab',
            'execute_script', 'get_cookies', 'get_cookies_by_domain', 'inject_css',
            'get_page_info', 'upload_file_to_tab',
            // Phase 2 (visual replay): capture active tab into PNG dataURL.
            // Background tabs return { skipped: 'tab_not_active' } instead of erroring.
            'capture_screenshot'
          ],
          sensitiveActions: ['execute_script', 'get_cookies', 'get_cookies_by_domain'],
          allowRawEval: false,
          requestTimeout: 1800000,
          rateLimit: {
            maxRequestsPerSecond: 10,
            blockDuration: 5000
          }
        };

    this.rawEvalExplicitlySet = false;

    // 认证相关属性（仅保留内部状态机用于 60s 安全网超时）
    this.authState = 'disconnected'; // disconnected | authenticating | authenticated | failed
    this.authTimeout = null;         // 认证超时定时器
    
    // 应用层心跳相关
    this.heartbeatTimer = null;      // 心跳定时器
    this.lastPongTime = null;        // 上次收到 pong 的时间
    this.heartbeatIntervalMs = 25000; // 心跳间隔 25 秒
    this.heartbeatMissThreshold = 2; // 连续丢失多少次 pong 后断开
    this.connectStartTime = null;    // 连接建立时间（用于诊断）
    
    // 连接实例追踪（防止孤儿连接干扰）
    this._connectionCounter = 0;     // 连接计数器，每次 connect() 递增
    this._currentConnectionId = 0;   // 当前活跃连接 ID
    this._connectDebounceTimer = null; // connect() 防重入定时器
    
    // 标签页数据防抖
    this.tabDataDebounceTimer = null;
    this.tabDataDebounceMs = 500;    // 防抖间隔 500ms
    
    // 初始化（稳定性工具在 init() 中 discoverServer() 之后初始化）
    this.init();
  }

async init() {
    console.log('Browser Control Extension 正在初始化...');
    
    // 一次性迁移清理：移除历史遗留的 HMAC 认证密钥 storage
    try {
      await browser.storage.local.remove(['auth_secret_key']);
    } catch (_) {}
    
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
    
    // 如果启用自动连接，则自动连接
    if (this.autoConnect) {
      console.log('自动连接已启用，正在连接...');
      this.connect();
    } else {
      console.log('扩展初始化完成 - 等待手动连接');
    }
  }
}

Object.assign(
  BrowserControl.prototype,
  globalThis.JSEyesPlatformConnectionMethods.createMethods(),
  globalThis.JSEyesPlatformServerMethods.createMethods(),
  globalThis.JSEyesPlatformOperationsMethods.createMethods(),
  globalThis.JSEyesPlatformRuntimeMethods.createMethods(),
  globalThis.JSEyesPlatformTabsMethods.createMethods(),
  globalThis.JSEyesSharedBrowserControl.createMethods(browser),
);

// 初始化扩展
const browserControl = new BrowserControl();

// 导出供其他脚本使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BrowserControl;
}
