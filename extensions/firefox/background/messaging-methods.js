'use strict';

(() => {
function createMethods(extensionApi) {
  if (!extensionApi) throw new TypeError('extensionApi is required');
  return {
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
  };
}

const sharedMethods = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedMethods;
}
globalThis.JSEyesMessagingMethods = sharedMethods;
})();
