export function registerBrowserActions({
  ensureBot,
  policyTextResultOrThrow,
  registerCoreAction,
  textResult,
}) {
registerCoreAction(
    "browser/get-tabs",
    {
      name: "browser/get-tabs",
      label: "JS Eyes: Get Tabs",
      description: "获取浏览器中所有已打开的标签页列表，包含每个标签页的 ID、URL、标题等信息。",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "目标浏览器的 clientId 或名称（如 'firefox'、'chrome'）。省略则返回所有浏览器的标签页。",
          },
        },
      },
      async execute(_toolCallId, params) {
        const b = ensureBot();
        const result = await b.getTabs({ target: params.target });
        const lines = [];
        if (result.browsers && result.browsers.length > 0) {
          for (const browser of result.browsers) {
            lines.push(`## ${browser.browserName} (${browser.clientId})`);
            for (const tab of browser.tabs) {
              const active = tab.id === result.activeTabId ? " [ACTIVE]" : "";
              lines.push(`  - [${tab.id}] ${tab.title || "(untitled)"}${active}`);
              lines.push(`    ${tab.url}`);
            }
          }
        } else {
          lines.push("当前没有浏览器扩展连接。");
        }
        return textResult(lines.join("\n"));
      },
    },
  );

registerCoreAction(
    "browser/list-clients",
    {
      name: "browser/list-clients",
      label: "JS Eyes: List Clients",
      description: "获取当前已连接到 JS-Eyes 服务器的浏览器扩展客户端列表。",
      parameters: { type: "object", properties: {} },
      async execute() {
        const b = ensureBot();
        const clients = await b.listClients();
        if (clients.length === 0) {
          return textResult("当前没有浏览器扩展连接到服务器。");
        }
        const lines = clients.map(
          (c) => `- ${c.browserName} (clientId: ${c.clientId}, tabs: ${c.tabCount})`,
        );
        return textResult(lines.join("\n"));
      },
    },
  );

registerCoreAction(
    "browser/open-url",
    {
      name: "browser/open-url",
      label: "JS Eyes: Open URL",
      description: "在浏览器中打开指定 URL。可以打开新标签页，也可以在已有标签页中导航。返回标签页 ID。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要打开的 URL" },
          tabId: {
            type: "number",
            description: "已有标签页 ID（传入则在该标签页导航，省略则新开标签页）",
          },
          windowId: {
            type: "number",
            description: "窗口 ID（新开标签页时可指定窗口）",
          },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["url"],
      },
      async execute(_toolCallId, params) {
        try {
          const b = ensureBot();
          const tabId = await b.openUrl(
            params.url,
            params.tabId ?? null,
            params.windowId ?? null,
            { target: params.target },
          );
          return textResult(`已打开 ${params.url}，标签页 ID: ${tabId}`);
        } catch (err) {
          return policyTextResultOrThrow(err);
        }
      },
    },
  );

registerCoreAction(
    "browser/close-tab",
    {
      name: "browser/close-tab",
      label: "JS Eyes: Close Tab",
      description: "关闭浏览器中指定 ID 的标签页。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "要关闭的标签页 ID" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId"],
      },
      async execute(_toolCallId, params) {
        try {
          const b = ensureBot();
          await b.closeTab(params.tabId, { target: params.target });
          return textResult(`已关闭标签页 ${params.tabId}`);
        } catch (err) {
          return policyTextResultOrThrow(err);
        }
      },
    },
  );

registerCoreAction(
    "browser/get-html",
    {
      name: "browser/get-html",
      label: "JS Eyes: Get HTML",
      description: "获取指定标签页的完整 HTML 内容。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId"],
      },
      async execute(_toolCallId, params) {
        try {
          const b = ensureBot();
          const html = await b.getTabHtml(params.tabId, { target: params.target });
          return textResult(html);
        } catch (err) {
          return policyTextResultOrThrow(err);
        }
      },
    },
  );

registerCoreAction(
    "browser/execute-script",
    {
      name: "browser/execute-script",
      label: "JS Eyes: Execute Script",
      description: "在指定标签页中执行 JavaScript 代码并返回执行结果。可用于提取页面数据、操作 DOM 等。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          code: { type: "string", description: "要执行的 JavaScript 代码" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId", "code"],
      },
      async execute(_toolCallId, params) {
        try {
          const b = ensureBot();
          const result = await b.executeScript(params.tabId, params.code, {
            target: params.target,
          });
          const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          return textResult(text);
        } catch (err) {
          return policyTextResultOrThrow(err);
        }
      },
    },
  );

registerCoreAction(
    "browser/get-cookies",
    {
      name: "browser/get-cookies",
      label: "JS Eyes: Get Cookies",
      description: "获取指定标签页对应域名的所有 Cookie。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId"],
      },
      async execute(_toolCallId, params) {
        try {
          const b = ensureBot();
          const cookies = await b.getCookies(params.tabId, { target: params.target });
          if (cookies.length === 0) {
            return textResult("该标签页没有 Cookie。");
          }
          return textResult(JSON.stringify(cookies, null, 2));
        } catch (err) {
          return policyTextResultOrThrow(err);
        }
      },
    },
  );

registerCoreAction(
    "browser/inject-css",
    {
      name: "browser/inject-css",
      label: "JS Eyes: Inject CSS",
      description: "向指定标签页注入自定义 CSS 样式。可用于隐藏页面元素、调整布局等。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          css: { type: "string", description: "要注入的 CSS 代码" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId", "css"],
      },
      async execute(_toolCallId, params) {
        try {
          const b = ensureBot();
          await b.injectCss(params.tabId, params.css, { target: params.target });
          return textResult(`已向标签页 ${params.tabId} 注入 CSS 样式`);
        } catch (err) {
          return policyTextResultOrThrow(err);
        }
      },
    },
  );

registerCoreAction(
    "browser/get-cookies-by-domain",
    {
      name: "browser/get-cookies-by-domain",
      label: "JS Eyes: Get Cookies By Domain",
      description: "按域名获取浏览器中的所有 Cookie，无需指定标签页。支持包含子域名。",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "目标域名（如 'example.com'）" },
          includeSubdomains: {
            type: "boolean",
            description: "是否包含子域名的 Cookie（默认 true）",
          },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["domain"],
      },
      async execute(_toolCallId, params) {
        try {
          const b = ensureBot();
          const cookies = await b.getCookiesByDomain(params.domain, {
            includeSubdomains: params.includeSubdomains,
            target: params.target,
          });
          if (cookies.length === 0) {
            return textResult(`域名 ${params.domain} 没有 Cookie。`);
          }
          return textResult(JSON.stringify(cookies, null, 2));
        } catch (err) {
          return policyTextResultOrThrow(err);
        }
      },
    },
  );

registerCoreAction(
    "browser/get-page-info",
    {
      name: "browser/get-page-info",
      label: "JS Eyes: Get Page Info",
      description: "获取指定标签页的页面信息，包括 URL、标题、状态和图标。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId"],
      },
      async execute(_toolCallId, params) {
        try {
          const b = ensureBot();
          const info = await b.getPageInfo(params.tabId, { target: params.target });
          return textResult(JSON.stringify(info, null, 2));
        } catch (err) {
          return policyTextResultOrThrow(err);
        }
      },
    },
  );

registerCoreAction(
    "browser/upload-file",
    {
      name: "browser/upload-file",
      label: "JS Eyes: Upload File",
      description: "向指定标签页的文件上传控件上传文件。文件以 Base64 编码传入，自动设置到页面的 file input 元素。",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "标签页 ID" },
          files: {
            type: "array",
            description: "要上传的文件列表",
            items: {
              type: "object",
              properties: {
                base64: { type: "string", description: "文件内容的 Base64 编码" },
                name: { type: "string", description: "文件名" },
                type: { type: "string", description: "MIME 类型（如 'image/png'）" },
              },
              required: ["base64", "name", "type"],
            },
          },
          targetSelector: {
            type: "string",
            description: "目标 file input 的 CSS 选择器（默认 'input[type=\"file\"]'）",
          },
          target: { type: "string", description: "目标浏览器 clientId 或名称" },
        },
        required: ["tabId", "files"],
      },
      async execute(_toolCallId, params) {
        try {
          const b = ensureBot();
          const result = await b.uploadFileToTab(params.tabId, params.files, {
            targetSelector: params.targetSelector,
            target: params.target,
          });
          return textResult(JSON.stringify({ success: true, uploadedFiles: result }, null, 2));
        } catch (err) {
          return policyTextResultOrThrow(err);
        }
      },
    },
  );
}
