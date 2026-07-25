import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  BROWSER_OPERATIONS,
  invokeBrowserOperation,
} = require("@js-eyes/protocol");

function openclawParameters(operation) {
  const schema = operation.inputSchema || { type: "object", properties: {} };
  const properties = { ...(schema.properties || {}) };
  // OpenClaw browser tools historically omit transport timeout from the schema.
  // page.waitFor uses `timeout` as wait duration (seconds) — keep it.
  if (operation.id !== "page.waitFor") {
    delete properties.timeout;
  }
  // Prefer Chinese descriptions already embedded in openclaw-oriented schemas.
  return {
    type: "object",
    properties,
    ...(Array.isArray(schema.required) && schema.required.length
      ? { required: schema.required.slice() }
      : {}),
    ...(Array.isArray(schema.anyOf) && schema.anyOf.length
      ? { anyOf: schema.anyOf.map((item) => ({ ...item })) }
      : {}),
  };
}

function formatOpenclawResult(operation, raw, params) {
  switch (operation.id) {
    case "tabs.list": {
      const lines = [];
      if (raw.browsers && raw.browsers.length > 0) {
        for (const browser of raw.browsers) {
          lines.push(`## ${browser.browserName} (${browser.clientId})`);
          for (const tab of browser.tabs) {
            const active = tab.id === raw.activeTabId ? " [ACTIVE]" : "";
            lines.push(`  - [${tab.id}] ${tab.title || "(untitled)"}${active}`);
            lines.push(`    ${tab.url}`);
          }
        }
      } else {
        lines.push("当前没有浏览器扩展连接。");
      }
      return lines.join("\n");
    }
    case "clients.list": {
      if (!raw.length) return "当前没有浏览器扩展连接到服务器。";
      return raw
        .map((c) => `- ${c.browserName} (clientId: ${c.clientId}, tabs: ${c.tabCount})`)
        .join("\n");
    }
    case "url.open":
      return `已打开 ${params.url}，标签页 ID: ${raw}`;
    case "tab.close":
      return `已关闭标签页 ${params.tabId}`;
    case "page.html":
      return typeof raw === "string" ? raw : String(raw ?? "");
    case "script.execute":
      return typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
    case "cookies.read":
      if (!raw.length) return "该标签页没有 Cookie。";
      return JSON.stringify(raw, null, 2);
    case "cookies.readDomain":
      if (!raw.length) return `域名 ${params.domain} 没有 Cookie。`;
      return JSON.stringify(raw, null, 2);
    case "style.inject":
      return `已向标签页 ${params.tabId} 注入 CSS 样式`;
    case "page.info":
      return JSON.stringify(raw, null, 2);
    case "file.upload":
      return JSON.stringify({ success: true, uploadedFiles: raw }, null, 2);
    default:
      return typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
  }
}

export function registerBrowserActions({
  ensureBot,
  policyTextResultOrThrow,
  registerCoreAction,
  textResult,
}) {
  for (const operation of BROWSER_OPERATIONS) {
    if (!operation.openclawAction) continue;

    registerCoreAction(operation.openclawAction, {
      name: operation.openclawAction,
      label: operation.label || operation.title,
      description: operation.openclawDescription || operation.description,
      parameters: openclawParameters(operation),
      async execute(_toolCallId, params = {}) {
        try {
          const browser = ensureBot();
          const raw = await invokeBrowserOperation(browser, operation, params);
          return textResult(formatOpenclawResult(operation, raw, params));
        } catch (err) {
          return policyTextResultOrThrow(err);
        }
      },
    });
  }
}
