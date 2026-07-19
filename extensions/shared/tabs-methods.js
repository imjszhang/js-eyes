'use strict';

(() => {
function createMethods(extensionApi) {
  if (!extensionApi) throw new TypeError('extensionApi is required');
  return {
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

startTabDataSync() {
    // 立即发送一次
    this.sendTabsData();

    // 每15秒发送一次标签页数据（降低轮询频率，标签页变化由事件驱动防抖发送）
    setInterval(() => {
      if (this.isConnected) {
        this.sendTabsData();
      }
    }, 15000);
  },
  };
}

const sharedMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedMethods;
}
globalThis.JSEyesTabSyncMethods = sharedMethods;
})();
