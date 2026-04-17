/**
 * JS Eyes Browser Extension - Popup Script (Chrome)
 * 
 * 处理popup界面的交互和状态显示
 */

class JSEyesPopup {
  constructor() {
    this.isInitialized = false;
    this.updateInterval = null;
    this.logs = [];
    this.maxLogs = 50;
    
    this.init();
  }

  /**
   * 初始化popup
   */
  async init() {
    if (this.isInitialized) return;
    
    console.log('JS Eyes Popup 正在初始化...');
    
    // 等待DOM加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this.setup();
      });
    } else {
      this.setup();
    }
    
    this.isInitialized = true;
  }

  /**
   * 设置popup
   */
  setup() {
    // 设置事件监听器
    this.setupEventListeners();
    
    // 监听来自 background script 的状态更新
    this.setupStatusListener();
    
    // 加载设置
    this.loadSettings();
    
    // 更新版本号
    this.updateVersion();
    
    // 更新状态
    this.updateStatus();
    
    // 开始定期更新
    this.startPeriodicUpdate();
    
    // 添加初始日志
    this.addLog(chrome.i18n.getMessage('logPopupInit'));
    
    console.log('JS Eyes Popup 初始化完成');
  }
  
  /**
   * 设置状态更新监听器
   */
  setupStatusListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'STATUS_UPDATE' && message.data) {
        this.updateExtendedStatus(message.data);
        
        // 同时更新连接状态
        if (message.data.isConnected !== undefined) {
          this.updateConnectionStatus({
            isConnected: message.data.isConnected,
            serverUrl: message.data.serverUrl
          });
        }
      }
      return false; // 不需要异步响应
    });
  }

  /**
   * 更新版本号显示
   */
  updateVersion() {
    try {
      const manifest = chrome.runtime.getManifest();
      if (manifest && manifest.version) {
        const versionBadge = document.getElementById('version-badge');
        if (versionBadge) {
          versionBadge.textContent = `v${manifest.version}`;
        }
      }
    } catch (error) {
      console.error('Failed to read version:', error);
    }
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    // 重新连接按钮
    document.getElementById('reconnect-btn').addEventListener('click', () => {
      this.reconnect();
    });
    
    // 发送数据按钮
    document.getElementById('send-data-btn').addEventListener('click', () => {
      this.sendData();
    });
    
    // 刷新标签页按钮
    document.getElementById('refresh-tabs').addEventListener('click', () => {
      this.refreshTabs();
    });
    
    // 清空日志按钮
    document.getElementById('clear-logs').addEventListener('click', () => {
      this.clearLogs();
    });
    
    // 保存服务器地址按钮
    document.getElementById('save-server').addEventListener('click', () => {
      this.saveServerUrl();
    });
    
    // 自动连接开关
    document.getElementById('auto-connect').addEventListener('change', (e) => {
      this.toggleAutoConnect(e.target.checked);
    });

    // 服务器地址输入框回车
    document.getElementById('server-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.saveServerUrl();
      }
    });

    const saveServerTokenBtn = document.getElementById('save-server-token');
    const clearServerTokenBtn = document.getElementById('clear-server-token');
    const serverTokenInput = document.getElementById('server-token-input');
    if (saveServerTokenBtn) {
      saveServerTokenBtn.addEventListener('click', () => this.saveServerToken());
    }
    if (serverTokenInput) {
      serverTokenInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.saveServerToken();
      });
    }
    if (clearServerTokenBtn) {
      clearServerTokenBtn.addEventListener('click', () => this.clearServerToken());
    }

    const syncBtn = document.getElementById('sync-token-from-native');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => this.syncTokenFromNativeHost());
    }
  }

  async syncTokenFromNativeHost() {
    const statusEl = document.getElementById('sync-token-status');
    if (statusEl) statusEl.textContent = 'Syncing...';
    chrome.runtime.sendMessage({ type: 'sync_token_from_native' }, (response) => {
      if (response && response.success) {
        if (statusEl) statusEl.textContent = 'Synced';
        if (this.showStatus) this.showStatus('Token synced from local host', 'success');
      } else {
        const reason = (response && response.reason) || 'unknown';
        if (statusEl) statusEl.textContent = `Failed: ${reason}`;
        if (this.showStatus) this.showStatus(`Sync failed: ${reason}`, 'error');
      }
    });
  }

  async saveServerToken() {
    const input = document.getElementById('server-token-input');
    const token = (input?.value || '').trim();
    if (!token) {
      this.showStatus && this.showStatus('Server token cannot be empty', 'error');
      return;
    }
    chrome.runtime.sendMessage({ type: 'save_server_token', token }, (response) => {
      if (response && response.success) {
        input.value = '';
        if (this.showStatus) this.showStatus('Server token saved', 'success');
      } else if (this.showStatus) {
        this.showStatus('Save failed: ' + ((response && response.error) || 'unknown'), 'error');
      }
    });
  }

  async clearServerToken() {
    chrome.runtime.sendMessage({ type: 'clear_server_token' }, (response) => {
      if (response && response.success && this.showStatus) {
        this.showStatus('Server token cleared', 'success');
      }
    });
  }

  /**
   * 加载设置
   */
  async loadSettings() {
    try {
      const result = await chrome.storage.local.get([
        'serverUrl',
        'autoConnect'
      ]);

      // 设置服务器地址
      if (result.serverUrl) {
        document.getElementById('server-input').value = result.serverUrl;
      }

      // 设置自动连接（默认启用）
      if (result.autoConnect !== undefined) {
        document.getElementById('auto-connect').checked = result.autoConnect;
      } else {
        document.getElementById('auto-connect').checked = true; // 默认启用
      }

      // 清理旧版本残留的 debugMode 键
      try { await chrome.storage.local.remove(['debugMode']); } catch (_) {}

    } catch (error) {
      console.error('加载设置时出错:', error);
      this.addLog(chrome.i18n.getMessage('logFailedLoadSettings', error.message));
    }
  }

  /**
   * 保存设置
   */
  async saveSetting(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
      this.addLog(chrome.i18n.getMessage('logSettingSaved', [key, String(value)]));
    } catch (error) {
      console.error('保存设置时出错:', error);
      this.addLog(chrome.i18n.getMessage('logFailedSaveSetting', error.message));
    }
  }

  /**
   * 切换自动连接设置
   */
  async toggleAutoConnect(enabled) {
    try {
      // 保存设置
      await this.saveSetting('autoConnect', enabled);
      
      // 通知background script更新自动连接设置
      chrome.runtime.sendMessage({
        type: 'set_auto_connect',
        autoConnect: enabled
      }, (response) => {
        if (response && response.success) {
          this.addLog(enabled ? 
            chrome.i18n.getMessage('logAutoConnectEnabled') : 
            chrome.i18n.getMessage('logAutoConnectDisabled')
          );
          
          // 延迟更新状态
          setTimeout(() => {
            this.updateStatus();
          }, 1000);
        } else {
          this.addLog(chrome.i18n.getMessage('logFailedUpdateAutoConnect'));
        }
      });
      
    } catch (error) {
      console.error('切换自动连接时出错:', error);
      this.addLog(chrome.i18n.getMessage('logFailedToggleAutoConnect', error.message));
    }
  }

  /**
   * 保存服务器地址
   */
  async saveServerUrl() {
    const serverUrl = document.getElementById('server-input').value.trim();
    
    if (!serverUrl) {
      this.addLog(chrome.i18n.getMessage('logServerEmpty'));
      return;
    }
    
    const validPrefixes = ['http://', 'https://', 'ws://', 'wss://'];
    if (!validPrefixes.some(p => serverUrl.startsWith(p))) {
      this.addLog(chrome.i18n.getMessage('logServerInvalidProtocol') || 'Invalid protocol. Use http://, https://, ws://, or wss://');
      return;
    }
    
    try {
      await this.saveSetting('serverUrl', serverUrl);
      this.addLog(chrome.i18n.getMessage('logServerSaved', serverUrl));
      
      // 更新显示
      document.getElementById('server-url').textContent = serverUrl;
      
      // 自动触发重新连接
      this.addLog(chrome.i18n.getMessage('logApplyingReconnect'));
      await this.reconnect();
      
    } catch (error) {
      console.error('保存服务器地址时出错:', error);
      this.addLog(chrome.i18n.getMessage('logFailedSaveServer', error.message));
    }
  }

  /**
   * 更新状态
   */
  async updateStatus() {
    try {
      // 获取background script的连接状态
      chrome.runtime.sendMessage({
        type: 'get_connection_status'
      }, (response) => {
        if (response) {
          this.updateConnectionStatus(response);
        }
      });
      
      // 获取扩展状态（包含健康检查等新信息）
      chrome.runtime.sendMessage({
        type: 'get_extended_status'
      }, (extendedStatus) => {
        if (extendedStatus) {
          this.updateExtendedStatus(extendedStatus);
        }
      });
      
      // 获取当前标签页信息
      await this.updateCurrentTabInfo();
      
      // 获取浏览器统计
      await this.updateBrowserStats();
      
    } catch (error) {
      console.error('更新状态时出错:', error);
      this.addLog(chrome.i18n.getMessage('logFailedUpdateStatus', error.message));
    }
  }
  
  /**
   * 更新扩展状态（健康检查、限流、熔断等）
   */
  updateExtendedStatus(status) {
    // 更新健康状态
    const healthStatusElement = document.getElementById('health-status');
    if (healthStatusElement && status.healthCheck) {
      const healthStatus = status.healthCheck.status || 'unknown';
      let statusClass = 'disconnected';
      let statusText = chrome.i18n.getMessage('statusUnknown') || 'Unknown';
      
      switch (healthStatus) {
        case 'healthy':
          statusClass = 'connected';
          statusText = chrome.i18n.getMessage('statusHealthy') || 'Healthy';
          break;
        case 'warning':
          statusClass = 'connecting';
          statusText = chrome.i18n.getMessage('statusWarning') || 'Warning';
          break;
        case 'critical':
          statusClass = 'disconnected';
          statusText = chrome.i18n.getMessage('statusCritical') || 'Critical';
          break;
      }
      
      healthStatusElement.textContent = statusText;
      healthStatusElement.className = `status-badge ${statusClass} px-3 py-1 text-xs font-bold`;
    }
    
    // 更新待处理请求数
    const pendingRequestsElement = document.getElementById('pending-requests');
    if (pendingRequestsElement && status.queueStatus) {
      pendingRequestsElement.textContent = status.queueStatus.size || 0;
    }
    
    // 更新限流状态
    const rateLimitElement = document.getElementById('rate-limit-status');
    if (rateLimitElement && status.rateLimitStatus) {
      const isBlocked = status.rateLimitStatus.isBlocked;
      rateLimitElement.textContent = isBlocked 
        ? (chrome.i18n.getMessage('statusBlocked') || 'Blocked')
        : (chrome.i18n.getMessage('statusNormal') || 'Normal');
      rateLimitElement.className = isBlocked
        ? 'status-badge disconnected px-3 py-1 text-xs font-bold'
        : 'status-badge connected px-3 py-1 text-xs font-bold';
    }
    
    // 更新熔断状态
    const circuitBreakerElement = document.getElementById('circuit-breaker-status');
    if (circuitBreakerElement && status.healthCheck) {
      const isOpen = status.healthCheck.isCircuitBreakerOpen;
      circuitBreakerElement.textContent = isOpen
        ? (chrome.i18n.getMessage('statusOpen') || 'Open')
        : (chrome.i18n.getMessage('statusClosed') || 'Closed');
      circuitBreakerElement.className = isOpen
        ? 'status-badge disconnected px-3 py-1 text-xs font-bold'
        : 'status-badge connected px-3 py-1 text-xs font-bold';
    }
  }

  /**
   * 更新连接状态
   */
  updateConnectionStatus(status) {
    const statusElement = document.getElementById('connection-status');
    const serverUrlElement = document.getElementById('server-url');
    const reconnectAttemptsElement = document.getElementById('reconnect-attempts');
    
    // 更新连接状态 - 使用 Neo-Brutalism 样式类
    const baseClasses = 'status-badge px-3 py-1 text-xs font-bold uppercase';
    if (status.isConnected) {
      statusElement.textContent = chrome.i18n.getMessage('statusConnected');
      statusElement.className = `${baseClasses} connected`;
    } else if (status.isConnecting) {
      statusElement.textContent = chrome.i18n.getMessage('statusConnecting');
      statusElement.className = `${baseClasses} connecting pulse`;
    } else {
      statusElement.textContent = chrome.i18n.getMessage('statusDisconnected');
      statusElement.className = `${baseClasses} disconnected`;
    }
    
    // 更新服务器地址
    if (status.serverUrl) {
      serverUrlElement.textContent = status.serverUrl;
    }
    
    // 更新重连次数
    reconnectAttemptsElement.textContent = status.reconnectAttempts || 0;
  }

  /**
   * 更新当前标签页信息
   */
  async updateCurrentTabInfo() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (tabs.length > 0) {
        const tab = tabs[0];
        
        document.getElementById('current-tab-title').textContent = tab.title || '-';
        document.getElementById('current-tab-url').textContent = tab.url || '-';
        document.getElementById('current-tab-id').textContent = tab.id || '-';
      } else {
        document.getElementById('current-tab-title').textContent = '-';
        document.getElementById('current-tab-url').textContent = '-';
        document.getElementById('current-tab-id').textContent = '-';
      }
      
    } catch (error) {
      console.error('更新当前标签页信息时出错:', error);
    }
  }

  /**
   * 更新浏览器统计
   */
  async updateBrowserStats() {
    try {
      const [tabs, windows] = await Promise.all([
        chrome.tabs.query({}),
        chrome.windows.getAll()
      ]);
      
      document.getElementById('total-tabs').textContent = tabs.length;
      document.getElementById('total-windows').textContent = windows.length;
      
      // 更新最后同步时间
      const now = new Date();
      const timeString = now.toLocaleTimeString('zh-CN', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      document.getElementById('last-sync').textContent = timeString;
      
    } catch (error) {
      console.error('更新浏览器统计时出错:', error);
    }
  }

  /**
   * 开始定期更新
   */
  startPeriodicUpdate() {
    // 每5秒更新一次状态
    this.updateInterval = setInterval(() => {
      this.updateStatus();
    }, 5000);
  }

  /**
   * 停止定期更新
   */
  stopPeriodicUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * 重新连接
   */
  async reconnect() {
    try {
      this.addLog(chrome.i18n.getMessage('logReconnecting'));
      
      // 通知background script使用新设置重新连接
      chrome.runtime.sendMessage({
        type: 'reconnect'
      }, (response) => {
        if (response && response.success) {
          this.addLog(chrome.i18n.getMessage('logReconnectSent'));
          
          // 延迟更新状态，给连接一些时间
          setTimeout(() => {
            this.updateStatus();
          }, 2000);
        } else {
          this.addLog(chrome.i18n.getMessage('logReconnectFailed'));
        }
      });
      
    } catch (error) {
      console.error('重新连接时出错:', error);
      this.addLog(chrome.i18n.getMessage('logFailedReconnect', error.message));
    }
  }

  /**
   * 发送数据
   */
  async sendData() {
    try {
      this.addLog(chrome.i18n.getMessage('logSendingData'));
      
      // 通知background script发送数据
      chrome.runtime.sendMessage({
        type: 'send_tabs_data'
      }, (response) => {
        if (response && response.success) {
          this.addLog(chrome.i18n.getMessage('logDataSentSuccess'));
          
          // 更新数据发送计数
          const currentCount = parseInt(document.getElementById('data-sent').textContent) || 0;
          document.getElementById('data-sent').textContent = currentCount + 1;
        } else {
          this.addLog(chrome.i18n.getMessage('logDataSentFailed'));
        }
      });
      
    } catch (error) {
      console.error('发送数据时出错:', error);
      this.addLog(chrome.i18n.getMessage('logFailedSendData', error.message));
    }
  }

  /**
   * 刷新标签页
   */
  async refreshTabs() {
    try {
      this.addLog(chrome.i18n.getMessage('logRefreshingTabs'));
      
      await this.updateCurrentTabInfo();
      await this.updateBrowserStats();
      
      this.addLog(chrome.i18n.getMessage('logTabsRefreshed'));
      
    } catch (error) {
      console.error('刷新标签页时出错:', error);
      this.addLog(chrome.i18n.getMessage('logFailedRefreshTabs', error.message));
    }
  }

  /**
   * 添加日志
   */
  addLog(message) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('zh-CN', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const logEntry = {
      time: timeString,
      message: message,
      timestamp: now.getTime()
    };
    
    // 添加到日志数组
    this.logs.unshift(logEntry);
    
    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
    
    // 更新显示
    this.updateLogsDisplay();
    
    console.log(`[${timeString}] ${message}`);
  }

  /**
   * 更新日志显示
   */
  updateLogsDisplay() {
    const container = document.getElementById('logs-container');
    
    // 清空现有内容
    container.innerHTML = '';
    
    // 添加日志项 - 使用 Neo-Brutalism 样式类
    this.logs.forEach(log => {
      const logItem = document.createElement('div');
      logItem.className = 'flex gap-2 py-1 text-xs border-b-3 border-brand-yellow last:border-b-0';
      
      const timeSpan = document.createElement('span');
      timeSpan.className = 'text-brand-yellow font-mono min-w-[60px] font-bold';
      timeSpan.textContent = log.time;
      
      const messageSpan = document.createElement('span');
      messageSpan.className = 'text-brand-yellow flex-1 font-bold';
      messageSpan.textContent = log.message;
      
      logItem.appendChild(timeSpan);
      logItem.appendChild(messageSpan);
      container.appendChild(logItem);
    });
    
    // 滚动到顶部显示最新日志
    container.scrollTop = 0;
  }

  /**
   * 清空日志
   */
  clearLogs() {
    this.logs = [];
    this.updateLogsDisplay();
    this.addLog(chrome.i18n.getMessage('logLogsCleared'));
  }

  /**
   * 销毁popup
   */
  destroy() {
    this.stopPeriodicUpdate();
    console.log('JS Eyes Popup 已销毁');
  }
}

// 初始化popup
const jsEyesPopup = new JSEyesPopup();

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  jsEyesPopup.destroy();
});

// 导出供其他脚本使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JSEyesPopup;
}
