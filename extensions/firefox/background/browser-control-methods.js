'use strict';

/**
 * Browser-neutral BrowserControl methods shared by Chrome and Firefox.
 * Platform APIs are injected explicitly to keep the core contract testable.
 */
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

sendRawMessage(message) {
    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    } else {
      console.warn('WebSocket未连接，无法发送消息:', message);
      return false;
    }
  },

sendMessage(message) {
    return this.sendRawMessage(message);
  },

generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  },

resolveRequest(requestId, result) {
    // 清理队列和去重标记
    if (this.queueManager && requestId) {
      this.queueManager.remove(requestId);
    }
    if (this.deduplicator && requestId) {
      this.deduplicator.markCompleted(requestId);
    }

    // 如果有待处理的请求回调，执行它
    if (this.pendingRequests.has(requestId)) {
      const callback = this.pendingRequests.get(requestId);
      this.pendingRequests.delete(requestId);
      if (callback) {
        callback(result);
      }
    }
  },

async handleCloseTab(message) {
    try {
      const { tabId, requestId } = message;

      await extensionApi.tabs.remove(parseInt(tabId));

      this.sendMessage({
        type: 'close_tab_complete',
        tabId: tabId,
        requestId: requestId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('处理关闭标签页请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: message.requestId
      });
    }
  },

async sendHtmlInChunks(tabId, html, requestId) {
    const chunkSize = 50000; // 50KB per chunk
    const totalChunks = Math.ceil(html.length / chunkSize);

    console.log(`HTML内容较大(${html.length}字符)，将分${totalChunks}块发送`);

    // 发送所有分块
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, html.length);
      const chunkData = html.substring(start, end);

      this.sendMessage({
        type: 'tab_html_chunk',
        tabId: tabId,
        chunkIndex: i,
        chunkData: chunkData,
        totalChunks: totalChunks,
        requestId: requestId,
        timestamp: new Date().toISOString()
      });

      // 小延迟避免消息过快
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // 发送完成消息
    this.sendMessage({
      type: 'tab_html_complete',
      tabId: tabId,
      html: html,
      totalChunks: totalChunks,
      requestId: requestId,
      timestamp: new Date().toISOString()
    });
  },

async handleGetCookies(message) {
    try {
      const { tabId, requestId } = message;

      const tab = await extensionApi.tabs.get(parseInt(tabId));
      const cookies = await this.getTabCookies(tabId, tab.url);

      // 只返回获取到的cookies，不触发保存
      // 服务器端会将这些cookies存储到独立的cookies表中
      this.sendMessage({
        type: 'get_cookies_complete',
        tabId: tabId,
        url: tab.url,
        cookies: cookies,
        requestId: requestId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('处理获取Cookies请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: message.requestId
      });
    }
  },

async handleGetCookiesByDomain(message) {
    try {
      const { domain, includeSubdomains = true, requestId } = message;

      if (!domain) {
        this.sendMessage({
          type: 'error',
          message: '缺少域名参数',
          requestId: requestId
        });
        return;
      }

      console.log(`[Cookie获取] 按域名获取cookies: ${domain}, 包含子域名: ${includeSubdomains}`);

      const cookies = await this.getCookiesByDomain(domain, includeSubdomains);

      this.sendMessage({
        type: 'get_cookies_by_domain_complete',
        domain: domain,
        includeSubdomains: includeSubdomains,
        cookies: cookies,
        total: cookies.length,
        requestId: requestId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('处理按域名获取Cookies请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: message.requestId
      });
    }
  },

async handleGetPageInfo(message) {
    try {
      const { tabId, requestId } = message;

      if (!tabId) {
        this.sendMessage({
          type: 'error',
          message: '缺少 tabId 参数',
          requestId: requestId
        });
        return;
      }

      const tab = await extensionApi.tabs.get(parseInt(tabId));

      this.sendMessage({
        type: 'get_page_info_complete',
        tabId: tab.id,
        data: {
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          status: tab.status,
          favIconUrl: tab.favIconUrl
        },
        requestId: requestId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('处理获取页面信息请求时出错:', error);
      this.sendMessage({
        type: 'error',
        message: error.message,
        requestId: message.requestId
      });
    }
  },

async getCookiesByDomain(domain, includeSubdomains = true) {
    try {
      console.log(`[Cookie获取] 开始按域名获取cookies: ${domain}`);

      const allCookies = [];
      let fetchStats = {
        mainDomain: 0,
        parentDomain: 0,
        subdomains: 0,
        stores: 0,
        total: 0,
        errors: 0
      };

      // 1. 获取精确域名的cookies
      try {
        const mainCookies = await extensionApi.cookies.getAll({ domain: domain });
        allCookies.push(...mainCookies);
        fetchStats.mainDomain = mainCookies.length;
        console.log(`[Cookie获取] 主域名 ${domain}: ${mainCookies.length} 个cookies`);
      } catch (error) {
        console.warn(`[Cookie获取] 主域名获取失败:`, error);
        fetchStats.errors++;
      }

      // 2. 获取带点前缀的域名cookies（如 .xiaohongshu.com）
      try {
        const dotDomain = domain.startsWith('.') ? domain : '.' + domain;
        const dotCookies = await extensionApi.cookies.getAll({ domain: dotDomain });
        allCookies.push(...dotCookies);
        fetchStats.parentDomain = dotCookies.length;
        console.log(`[Cookie获取] 点域名 ${dotDomain}: ${dotCookies.length} 个cookies`);
      } catch (error) {
        console.debug(`[Cookie获取] 点域名获取失败:`, error);
        fetchStats.errors++;
      }

      // 3. 如果包含子域名，获取常见子域名的cookies
      if (includeSubdomains) {
        const baseDomain = domain.startsWith('.') ? domain.slice(1) : domain;
        const subdomainPatterns = [
          'www.' + baseDomain,
          'api.' + baseDomain,
          'm.' + baseDomain,
          'mobile.' + baseDomain,
          'app.' + baseDomain,
          'cdn.' + baseDomain,
          'edith.' + baseDomain,  // 小红书特有
          'sns-webpic-qc.' + baseDomain,
          'fe-video-qc.' + baseDomain
        ];

        let subdomainCount = 0;
        for (const subdomain of subdomainPatterns) {
          try {
            const subCookies = await extensionApi.cookies.getAll({ domain: subdomain });
            if (subCookies.length > 0) {
              allCookies.push(...subCookies);
              subdomainCount += subCookies.length;
              console.log(`[Cookie获取] 子域名 ${subdomain}: ${subCookies.length} 个cookies`);
            }
          } catch (error) {
            // 子域名获取失败是正常的，静默处理
          }
        }
        fetchStats.subdomains = subdomainCount;
      }

      // 4. 尝试从不同的cookie存储分区获取
      try {
        const stores = await extensionApi.cookies.getAllCookieStores();
        let storeCount = 0;
        for (const store of stores) {
          try {
            const storeCookies = await extensionApi.cookies.getAll({
              domain: domain,
              storeId: store.id
            });
            if (storeCookies.length > 0) {
              allCookies.push(...storeCookies);
              storeCount += storeCookies.length;
            }
          } catch (error) {
            // 静默处理
          }
        }
        fetchStats.stores = storeCount;
      } catch (error) {
        console.debug('[Cookie获取] 存储分区获取失败:', error);
      }

      // 5. 去重和验证
      const uniqueCookies = this.deduplicateCookies(allCookies);
      const validatedCookies = this.validateCookies(uniqueCookies);
      fetchStats.total = validatedCookies.length;

      console.log(`[Cookie获取] 按域名完成 - 原始: ${allCookies.length}, 去重后: ${uniqueCookies.length}, 验证后: ${validatedCookies.length}`);
      console.log(`[Cookie获取] 统计:`, fetchStats);

      return validatedCookies;

    } catch (error) {
      console.error('[Cookie获取] 按域名获取cookies时出错:', error);
      return [];
    }
  },

async getTabCookies(tabId, url = null) {
    try {
      if (!url) {
        const tab = await extensionApi.tabs.get(parseInt(tabId));
        url = tab.url;
      }

      // URL验证
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        console.warn(`[Cookie获取] 跳过非HTTP(S)协议的URL: ${url}`);
        return [];
      }

      console.log(`[Cookie获取] 开始获取标签页 ${tabId} 的cookies，URL: ${url}`);

      const urlObj = new URL(url);
      const allCookies = [];
      let fetchStats = {
        mainDomain: 0,
        parentDomain: 0,
        subdomains: 0,
        urlBased: 0,
        stores: 0,
        total: 0,
        errors: 0
      };

      // 1. 获取当前域名的cookies
      try {
        const mainDomainCookies = await extensionApi.cookies.getAll({
          domain: urlObj.hostname
        });
        allCookies.push(...mainDomainCookies);
        fetchStats.mainDomain = mainDomainCookies.length;
        console.log(`[Cookie获取] 主域名 ${urlObj.hostname}: ${mainDomainCookies.length} 个cookies`);
      } catch (error) {
        console.warn(`[Cookie获取] 主域名获取失败:`, error);
        fetchStats.errors++;
      }

      // 2. 获取父域名的cookies（如 .example.com）
      const domainParts = urlObj.hostname.split('.');
      if (domainParts.length > 2) {
        const parentDomain = '.' + domainParts.slice(-2).join('.');
        try {
          const parentDomainCookies = await extensionApi.cookies.getAll({
            domain: parentDomain
          });
          allCookies.push(...parentDomainCookies);
          fetchStats.parentDomain = parentDomainCookies.length;
          console.log(`[Cookie获取] 父域名 ${parentDomain}: ${parentDomainCookies.length} 个cookies`);
        } catch (error) {
          console.debug(`[Cookie获取] 父域名 ${parentDomain} 获取失败:`, error);
          fetchStats.errors++;
        }
      }

      // 3. 获取常见子域名的cookies
      const subdomainPatterns = [
        'www.' + urlObj.hostname,
        'api.' + urlObj.hostname,
        'm.' + urlObj.hostname,
        'mobile.' + urlObj.hostname,
        'app.' + urlObj.hostname,
        'cdn.' + urlObj.hostname
      ];

      let subdomainCount = 0;
      for (const subdomain of subdomainPatterns) {
        try {
          const subdomainCookies = await extensionApi.cookies.getAll({
            domain: subdomain
          });
          if (subdomainCookies.length > 0) {
            allCookies.push(...subdomainCookies);
            subdomainCount += subdomainCookies.length;
            console.log(`[Cookie获取] 子域名 ${subdomain}: ${subdomainCookies.length} 个cookies`);
          }
        } catch (error) {
          console.debug(`[Cookie获取] 子域名 ${subdomain} 获取失败:`, error);
          fetchStats.errors++;
        }
      }
      fetchStats.subdomains = subdomainCount;

      // 4. 获取当前URL的所有cookies（包括第三方）
      try {
        const urlCookies = await extensionApi.cookies.getAll({
          url: url
        });
        allCookies.push(...urlCookies);
        fetchStats.urlBased = urlCookies.length;
        console.log(`[Cookie获取] URL相关cookies: ${urlCookies.length} 个`);
      } catch (error) {
        console.debug('[Cookie获取] URL cookies获取失败:', error);
        fetchStats.errors++;
      }

      // 5. 尝试获取不同存储分区的cookies
      try {
        const storeIds = await extensionApi.cookies.getAllCookieStores();
        let storeCount = 0;
        for (const store of storeIds) {
          try {
            const storeCookies = await extensionApi.cookies.getAll({
              url: url,
              storeId: store.id
            });
            if (storeCookies.length > 0) {
              allCookies.push(...storeCookies);
              storeCount += storeCookies.length;
              console.log(`[Cookie获取] 存储分区 ${store.id}: ${storeCookies.length} 个cookies`);
            }
          } catch (error) {
            console.debug(`[Cookie获取] 存储分区 ${store.id} 获取失败:`, error);
            fetchStats.errors++;
          }
        }
        fetchStats.stores = storeCount;
      } catch (error) {
        console.debug('[Cookie获取] 存储分区获取失败:', error);
        fetchStats.errors++;
      }

      // 6. 去重处理和数据验证
      const uniqueCookies = this.deduplicateCookies(allCookies);
      const validatedCookies = this.validateCookies(uniqueCookies);
      fetchStats.total = validatedCookies.length;

      console.log(`[Cookie获取] 完成 - 原始: ${allCookies.length}, 去重后: ${uniqueCookies.length}, 验证后: ${validatedCookies.length}`);
      console.log(`[Cookie获取] 统计:`, fetchStats);

      // 7. 分析cookie域名分布
      const domainStats = this.analyzeCookieDomains(validatedCookies);
      console.log(`[Cookie获取] 域名分布:`, domainStats);

      return validatedCookies;

    } catch (error) {
      console.error('[Cookie获取] 获取cookies时出错:', error);
      return [];
    }
  },

deduplicateCookies(cookies) {
    const seen = new Set();
    const uniqueCookies = [];

    for (const cookie of cookies) {
      // 使用 name + domain + path 作为唯一标识
      const key = `${cookie.name}@${cookie.domain}${cookie.path || '/'}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueCookies.push(cookie);
      }
    }

    return uniqueCookies;
  },

validateCookies(cookies) {
    const validCookies = [];
    let invalidCount = 0;

    for (const cookie of cookies) {
      try {
        // 基本字段验证
        if (!cookie.name || typeof cookie.name !== 'string') {
          throw new Error('Cookie名称无效');
        }

        // 长度验证
        if (cookie.name.length > 4096) {
          throw new Error('Cookie名称过长');
        }

        if (cookie.value && cookie.value.length > 4096) {
          throw new Error('Cookie值过长');
        }

        // 域名验证
        if (cookie.domain && typeof cookie.domain === 'string') {
          // 简单的域名格式验证
          if (!/^[a-zA-Z0-9.-]+$/.test(cookie.domain.replace(/^\./, ''))) {
            throw new Error('Cookie域名格式无效');
          }
        }

        // sameSite值验证和标准化
        if (cookie.sameSite) {
          const validSameSiteValues = ['strict', 'lax', 'none', 'no_restriction', 'unspecified'];
          if (!validSameSiteValues.includes(cookie.sameSite.toLowerCase())) {
            console.warn(`[Cookie验证] 未知的sameSite值: ${cookie.sameSite}，将设为unspecified`);
            cookie.sameSite = 'unspecified';
          }
        }

        validCookies.push(cookie);

      } catch (error) {
        invalidCount++;
        console.warn(`[Cookie验证] 跳过无效cookie ${cookie.name}: ${error.message}`);
      }
    }

    if (invalidCount > 0) {
      console.log(`[Cookie验证] 跳过了 ${invalidCount} 个无效cookies`);
    }

    return validCookies;
  },

analyzeCookieDomains(cookies) {
    const domainStats = {};
    cookies.forEach(cookie => {
      const domain = cookie.domain || 'unknown';
      domainStats[domain] = (domainStats[domain] || 0) + 1;
    });
    return domainStats;
  },

async waitForTabLoad(tabId, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('等待标签页加载超时'));
      }, timeout);

      const checkStatus = async () => {
        try {
          const tab = await extensionApi.tabs.get(parseInt(tabId));
          if (tab.status === 'complete') {
            clearTimeout(timeoutId);
            resolve(tab);
          } else {
            setTimeout(checkStatus, 500);
          }
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error);
        }
      };

      checkStatus();
    });
  },

debouncedSendTabsData() {
    if (this.tabDataDebounceTimer) {
      clearTimeout(this.tabDataDebounceTimer);
    }
    this.tabDataDebounceTimer = setTimeout(() => {
      this.tabDataDebounceTimer = null;
      this.sendTabsData();
    }, this.tabDataDebounceMs);
  },

setupTabListeners() {
    // 标签页创建
    extensionApi.tabs.onCreated.addListener((tab) => {
      console.log('标签页创建:', tab.id, tab.url);
      this.debouncedSendTabsData();
    });

    // 标签页更新
    extensionApi.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        console.log('标签页加载完成:', tabId, tab.url);
        this.debouncedSendTabsData();
      }
    });

    // 标签页移除
    extensionApi.tabs.onRemoved.addListener((tabId, removeInfo) => {
      console.log('标签页移除:', tabId);
      this.debouncedSendTabsData();
    });

    // 标签页激活
    extensionApi.tabs.onActivated.addListener((activeInfo) => {
      console.log('标签页激活:', activeInfo.tabId);
      this.debouncedSendTabsData();
    });
  },

async handleContentScriptRequest(message, sender) {
    const { action, payload, requestId, sourceUrl } = message;

    try {
      // 验证操作是否在白名单中
      if (!this.securityConfig.allowedActions.includes(action)) {
        console.warn(`[Background] 拒绝不允许的操作: ${action}`);
        return { success: false, error: `不允许的操作: ${action}` };
      }

      // 敏感操作验证
      if (this.securityConfig.sensitiveActions.includes(action)) {
        const isValid = await this.validateSensitiveOperation(action, sender, payload);
        if (!isValid) {
          return { success: false, error: '敏感操作验证失败' };
        }
      }

      // 根据操作类型执行相应处理
      switch (action) {
        case 'get_tabs':
          return await this.handleGetTabsRequest(payload);

        case 'get_html':
          return await this.handleGetHtmlRequest(payload);

        case 'open_url':
          return await this.handleOpenUrlRequest(payload);

        case 'close_tab':
          return await this.handleCloseTabRequest(payload);

        case 'execute_script':
          return await this.handleExecuteScriptRequest(payload, sender);

        case 'get_cookies':
          return await this.handleGetCookiesRequest(payload);

        case 'get_cookies_by_domain':
          return await this.handleGetCookiesByDomainRequest(payload);

        case 'inject_css':
          return await this.handleInjectCssRequest(payload);

        case 'get_page_info':
          return await this.handleGetPageInfoRequest(payload, sender);

        case 'upload_file_to_tab':
          return await this.handleUploadFileRequest(payload);

        default:
          return { success: false, error: `未知操作: ${action}` };
      }

    } catch (error) {
      console.error(`[Background] 处理请求时出错: ${action}`, error);
      return { success: false, error: error.message };
    }
  },

async handleGetTabsRequest(payload) {
    try {
      const tabs = await extensionApi.tabs.query({});
      const activeTab = await extensionApi.tabs.query({ active: true, currentWindow: true });

      const tabsData = tabs.map(tab => ({
        id: tab.id,
        url: tab.url || '',
        title: tab.title || '',
        isActive: activeTab.length > 0 && activeTab[0].id === tab.id,
        windowId: tab.windowId,
        index: tab.index,
        favIconUrl: tab.favIconUrl || null,
        status: tab.status || 'complete'
      }));

      return {
        success: true,
        data: {
          tabs: tabsData,
          activeTabId: activeTab.length > 0 ? activeTab[0].id : null
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

async handleOpenUrlRequest(payload) {
    try {
      const { url, tabId, windowId } = payload || {};

      if (!url) {
        return { success: false, error: '缺少 url 参数' };
      }

      let resultTabId;

      if (tabId) {
        await extensionApi.tabs.update(parseInt(tabId), { url: url });
        resultTabId = parseInt(tabId);
      } else {
        const createProperties = { url: url };
        if (windowId) {
          createProperties.windowId = parseInt(windowId);
        }
        const tab = await extensionApi.tabs.create(createProperties);
        resultTabId = tab.id;
      }

      return {
        success: true,
        data: { tabId: resultTabId, url: url }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

async handleCloseTabRequest(payload) {
    try {
      const tabId = payload?.tabId;
      if (!tabId) {
        return { success: false, error: '缺少 tabId 参数' };
      }

      await extensionApi.tabs.remove(parseInt(tabId));

      return {
        success: true,
        data: { tabId: parseInt(tabId), closed: true }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

async handleGetCookiesRequest(payload) {
    try {
      const tabId = payload?.tabId;
      if (!tabId) {
        return { success: false, error: '缺少 tabId 参数' };
      }

      const tab = await extensionApi.tabs.get(parseInt(tabId));
      const cookies = await this.getTabCookies(tabId, tab.url);

      return {
        success: true,
        data: {
          cookies: cookies,
          url: tab.url,
          tabId: parseInt(tabId)
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

async handleGetCookiesByDomainRequest(payload) {
    try {
      const { domain, includeSubdomains = true } = payload || {};

      if (!domain) {
        return { success: false, error: '缺少 domain 参数' };
      }

      const cookies = await this.getCookiesByDomain(domain, includeSubdomains);

      return {
        success: true,
        data: {
          cookies: cookies,
          domain: domain,
          includeSubdomains: includeSubdomains,
          total: cookies.length
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

async handleGetPageInfoRequest(payload, sender) {
    try {
      const tabId = payload?.tabId || sender.tab?.id;

      if (!tabId) {
        return { success: false, error: '无法确定目标标签页' };
      }

      const tab = await extensionApi.tabs.get(parseInt(tabId));

      return {
        success: true,
        data: {
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          status: tab.status,
          favIconUrl: tab.favIconUrl
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
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

startTabDataSync() {
    // 立即发送一次
    this.sendTabsData();

    // 每15秒发送一次标签页数据（降低轮询频率，标签页变化由事件驱动防抖发送）
    setInterval(() => {
      if (this.isConnected) {
        this.sendTabsData();
      }
    }, 15000);
  }
  };
}

const sharedBrowserControl = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedBrowserControl;
}
globalThis.JSEyesSharedBrowserControl = sharedBrowserControl;
