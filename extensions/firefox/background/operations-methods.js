'use strict';

(() => {
function createMethods(extensionApi) {
  if (!extensionApi) throw new TypeError('extensionApi is required');
  return {
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
  };
}

const sharedMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedMethods;
}
globalThis.JSEyesBrowserOperationMethods = sharedMethods;
})();
