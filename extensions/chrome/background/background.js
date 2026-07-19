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
import './connection-methods.js';
import './messaging-methods.js';
import './operations-methods.js';
import './routing-methods.js';
import './tabs-methods.js';
import './browser-control-methods.js';
import './platform-connection-methods.js';
import './platform-server-methods.js';
import './platform-operations-methods.js';
import './platform-runtime-methods.js';
import './platform-tabs-methods.js';

const EXTENSION_CONFIG = globalThis.EXTENSION_CONFIG;
const { withTimeout } = globalThis.ExtensionUtils;
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
}

Object.assign(
  BrowserControl.prototype,
  globalThis.JSEyesPlatformConnectionMethods.createMethods(),
  globalThis.JSEyesPlatformServerMethods.createMethods(),
  globalThis.JSEyesPlatformOperationsMethods.createMethods(),
  globalThis.JSEyesPlatformRuntimeMethods.createMethods(),
  globalThis.JSEyesPlatformTabsMethods.createMethods(),
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
