'use strict';

function createMethods(extensionApi) {
  if (!extensionApi) throw new TypeError('extensionApi is required');
  return {
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
  };
}

const sharedMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedMethods;
}
globalThis.JSEyesRuntimeRoutingMethods = sharedMethods;
