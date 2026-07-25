'use strict';

/**
 * Canonical browser-operation metadata.
 *
 * Names, routing, permissions, policy identity, input schemas, and host tool
 * titles live here. Hosts adapt transport/result formatting only.
 */

const TARGET_PROP = Object.freeze({
  type: 'string',
  minLength: 1,
  maxLength: 200,
  description: 'Extension clientId or unique browser name.',
});

const TAB_ID_PROP = Object.freeze({
  type: 'integer',
  minimum: 0,
  description: 'Browser tab ID.',
});

const TIMEOUT_PROP = Object.freeze({
  type: 'number',
  exclusiveMinimum: 0,
  maximum: 1800,
  description: 'Operation timeout in seconds.',
});

function objectSchema(properties, required = [], extras = {}) {
  const schema = {
    type: 'object',
    properties: Object.freeze(properties),
    ...(required.length ? { required: Object.freeze(required.slice()) } : {}),
    additionalProperties: false,
  };
  if (extras.anyOf) {
    schema.anyOf = Object.freeze(extras.anyOf.map((item) => Object.freeze({
      ...item,
      ...(Array.isArray(item.required)
        ? { required: Object.freeze(item.required.slice()) }
        : {}),
    })));
  }
  return Object.freeze(schema);
}

const BROWSER_OPERATIONS = Object.freeze([
  {
    id: 'tabs.list',
    wireAction: 'get_tabs',
    sdkMethod: 'getTabs',
    openclawAction: 'browser/get-tabs',
    mcpTool: 'browser_list_tabs',
    capability: 'browser.tabs.read',
    risk: 'read',
    routing: 'server',
    profiles: Object.freeze(['safe', 'full']),
    title: 'JS Eyes: List Tabs',
    label: 'JS Eyes: Get Tabs',
    description: 'List open browser tabs. Without target, tabs from all connected extensions are returned.',
    openclawDescription: '获取浏览器中所有已打开的标签页列表，包含每个标签页的 ID、URL、标题等信息。',
    inputSchema: objectSchema({
      target: { ...TARGET_PROP, description: '目标浏览器的 clientId 或名称（如 firefox、chrome）。省略则返回所有浏览器的标签页。' },
      timeout: TIMEOUT_PROP,
    }),
    annotations: Object.freeze({ readOnly: true, idempotent: true }),
  },
  {
    id: 'clients.list',
    wireAction: 'list_clients',
    sdkMethod: 'listClients',
    openclawAction: 'browser/list-clients',
    mcpTool: 'browser_list_clients',
    capability: 'browser.tabs.read',
    risk: 'read',
    routing: 'server',
    profiles: Object.freeze(['safe', 'full']),
    title: 'JS Eyes: List Browser Clients',
    label: 'JS Eyes: List Clients',
    description: 'List browser extensions connected to the local JS Eyes server.',
    openclawDescription: '获取当前已连接到 JS-Eyes 服务器的浏览器扩展客户端列表。',
    inputSchema: objectSchema({}),
    annotations: Object.freeze({ readOnly: true, idempotent: true }),
  },
  {
    id: 'url.open',
    wireAction: 'open_url',
    sdkMethod: 'openUrl',
    policyTool: 'openUrl',
    openclawAction: 'browser/open-url',
    mcpTool: 'browser_open_url',
    capability: 'browser.navigation',
    risk: 'interactive',
    routing: 'extension',
    profiles: Object.freeze(['safe', 'full']),
    title: 'JS Eyes: Open URL',
    label: 'JS Eyes: Open URL',
    description: 'Open a URL in a new tab or navigate an existing tab. JS Eyes egress policy applies.',
    openclawDescription: '在浏览器中打开指定 URL。可以打开新标签页，也可以在已有标签页中导航。返回标签页 ID。',
    inputSchema: objectSchema({
      url: { type: 'string', format: 'uri', maxLength: 8192, description: '要打开的 URL' },
      tabId: { ...TAB_ID_PROP, description: '已有标签页 ID（传入则在该标签页导航，省略则新开标签页）' },
      windowId: { type: 'integer', minimum: 0, description: '窗口 ID（新开标签页时可指定窗口）' },
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
    }, ['url']),
    annotations: Object.freeze({ openWorld: true }),
  },
  {
    id: 'tab.close',
    wireAction: 'close_tab',
    sdkMethod: 'closeTab',
    openclawAction: 'browser/close-tab',
    mcpTool: 'browser_close_tab',
    capability: 'browser.navigation',
    risk: 'interactive',
    routing: 'extension',
    profiles: Object.freeze(['safe', 'full']),
    title: 'JS Eyes: Close Tab',
    label: 'JS Eyes: Close Tab',
    description: 'Close a browser tab.',
    openclawDescription: '关闭浏览器中指定 ID 的标签页。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
    }, ['tabId']),
    annotations: Object.freeze({ destructive: true, idempotent: true }),
  },
  {
    id: 'page.html',
    wireAction: 'get_html',
    sdkMethod: 'getTabHtml',
    openclawAction: 'browser/get-html',
    mcpTool: 'browser_get_html',
    capability: 'browser.page.read',
    risk: 'read',
    routing: 'extension',
    profiles: Object.freeze(['safe', 'full']),
    title: 'JS Eyes: Get Page HTML',
    label: 'JS Eyes: Get HTML',
    description: 'Read HTML from a browser tab. Output is truncated to the requested character limit.',
    openclawDescription: '获取指定标签页的完整 HTML 内容。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
      maxChars: { type: 'integer', minimum: 1000, maximum: 1000000 },
    }, ['tabId']),
    annotations: Object.freeze({ readOnly: true, idempotent: true }),
  },
  {
    id: 'script.execute',
    wireAction: 'execute_script',
    sdkMethod: 'executeScript',
    policyTool: 'executeScript',
    openclawAction: 'browser/execute-script',
    mcpTool: 'browser_execute_script',
    capability: 'browser.script.execute',
    risk: 'destructive',
    routing: 'extension',
    sensitive: true,
    profiles: Object.freeze(['full']),
    title: 'JS Eyes: Execute JavaScript',
    label: 'JS Eyes: Execute Script',
    description: 'Execute JavaScript in a browser tab. This is a high-risk full-profile tool.',
    openclawDescription: '在指定标签页中执行 JavaScript 代码并返回执行结果。可用于提取页面数据、操作 DOM 等。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      code: { type: 'string', minLength: 1, maxLength: 200000, description: '要执行的 JavaScript 代码' },
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
    }, ['tabId', 'code']),
    annotations: Object.freeze({ destructive: true, openWorld: true }),
  },
  {
    id: 'style.inject',
    wireAction: 'inject_css',
    sdkMethod: 'injectCss',
    policyTool: 'injectCss',
    openclawAction: 'browser/inject-css',
    mcpTool: 'browser_inject_css',
    capability: 'browser.css.inject',
    risk: 'interactive',
    routing: 'extension',
    sensitive: true,
    profiles: Object.freeze(['full']),
    title: 'JS Eyes: Inject CSS',
    label: 'JS Eyes: Inject CSS',
    description: 'Inject CSS into a browser tab. This is a high-risk full-profile tool.',
    openclawDescription: '向指定标签页注入自定义 CSS 样式。可用于隐藏页面元素、调整布局等。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      css: { type: 'string', minLength: 1, maxLength: 200000, description: '要注入的 CSS 代码' },
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
    }, ['tabId', 'css']),
    annotations: Object.freeze({ destructive: true }),
  },
  {
    id: 'cookies.read',
    wireAction: 'get_cookies',
    sdkMethod: 'getCookies',
    policyTool: 'getCookies',
    openclawAction: 'browser/get-cookies',
    mcpTool: 'browser_get_cookies',
    capability: 'browser.cookies.read',
    risk: 'read',
    routing: 'extension',
    sensitive: true,
    profiles: Object.freeze(['full']),
    title: 'JS Eyes: Get Cookies',
    label: 'JS Eyes: Get Cookies',
    description: 'Read cookies for a browser tab. This sensitive tool is available only in the full profile.',
    openclawDescription: '获取指定标签页对应域名的所有 Cookie。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
    }, ['tabId']),
    annotations: Object.freeze({ readOnly: true, idempotent: true }),
  },
  {
    id: 'cookies.readDomain',
    wireAction: 'get_cookies_by_domain',
    sdkMethod: 'getCookiesByDomain',
    policyTool: 'getCookiesByDomain',
    openclawAction: 'browser/get-cookies-by-domain',
    mcpTool: 'browser_get_cookies_by_domain',
    capability: 'browser.cookies.read',
    risk: 'read',
    routing: 'extension',
    sensitive: true,
    profiles: Object.freeze(['full']),
    title: 'JS Eyes: Get Cookies By Domain',
    label: 'JS Eyes: Get Cookies By Domain',
    description: 'Read cookies by domain. This sensitive tool is available only in the full profile.',
    openclawDescription: '按域名获取浏览器中的所有 Cookie，无需指定标签页。支持包含子域名。',
    inputSchema: objectSchema({
      domain: { type: 'string', minLength: 1, maxLength: 253, description: "目标域名（如 'example.com'）" },
      includeSubdomains: { type: 'boolean', description: '是否包含子域名的 Cookie（默认 true）' },
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
    }, ['domain']),
    annotations: Object.freeze({ readOnly: true, idempotent: true }),
  },
  {
    id: 'page.info',
    wireAction: 'get_page_info',
    sdkMethod: 'getPageInfo',
    openclawAction: 'browser/get-page-info',
    mcpTool: 'browser_get_page_info',
    capability: 'browser.page.read',
    risk: 'read',
    routing: 'extension',
    profiles: Object.freeze(['safe', 'full']),
    title: 'JS Eyes: Get Page Info',
    label: 'JS Eyes: Get Page Info',
    description: 'Read URL, title, status, and other metadata from a browser tab.',
    openclawDescription: '获取指定标签页的页面信息，包括 URL、标题、状态和图标。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
    }, ['tabId']),
    annotations: Object.freeze({ readOnly: true, idempotent: true }),
  },
  {
    id: 'file.upload',
    wireAction: 'upload_file_to_tab',
    sdkMethod: 'uploadFileToTab',
    policyTool: 'uploadFileToTab',
    openclawAction: 'browser/upload-file',
    mcpTool: 'browser_upload_file',
    capability: 'browser.files.upload',
    risk: 'destructive',
    routing: 'extension',
    sensitive: true,
    profiles: Object.freeze(['full']),
    title: 'JS Eyes: Upload File',
    label: 'JS Eyes: Upload File',
    description: 'Upload base64-encoded files through a page file input. Available only in the full profile.',
    openclawDescription: '向指定标签页的文件上传控件上传文件。文件以 Base64 编码传入，自动设置到页面的 file input 元素。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      files: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        description: '要上传的文件列表',
        items: {
          type: 'object',
          properties: {
            base64: { type: 'string', minLength: 1, maxLength: 20000000, description: '文件内容的 Base64 编码' },
            name: { type: 'string', minLength: 1, maxLength: 255, description: '文件名' },
            type: { type: 'string', minLength: 1, maxLength: 255, description: "MIME 类型（如 'image/png'）" },
          },
          required: ['base64', 'name', 'type'],
          additionalProperties: false,
        },
      },
      targetSelector: {
        type: 'string',
        minLength: 1,
        maxLength: 2000,
        description: '目标 file input 的 CSS 选择器（默认 input[type="file"]）',
      },
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
    }, ['tabId', 'files']),
    annotations: Object.freeze({ destructive: true }),
  },
  {
    id: 'screenshot.capture',
    wireAction: 'capture_screenshot',
    sdkMethod: 'captureScreenshot',
    mcpTool: 'browser_take_screenshot',
    capability: 'browser.screenshot',
    risk: 'read',
    routing: 'extension',
    profiles: Object.freeze(['safe', 'full']),
    title: 'JS Eyes: Take Screenshot',
    label: 'JS Eyes: Take Screenshot',
    description: 'Capture a browser tab and return native MCP image content.',
    openclawDescription: '截取指定标签页的屏幕截图。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
      format: { type: 'string', enum: Object.freeze(['png', 'jpeg']) },
      quality: { type: 'integer', minimum: 0, maximum: 100 },
      fullPage: { type: 'boolean' },
    }, ['tabId']),
    annotations: Object.freeze({ readOnly: true, idempotent: true }),
  },
  {
    id: 'page.click',
    wireAction: 'click',
    sdkMethod: 'click',
    openclawAction: 'browser/click',
    mcpTool: 'browser_click',
    capability: 'browser.page.interact',
    risk: 'interactive',
    routing: 'extension',
    profiles: Object.freeze(['safe', 'full']),
    title: 'JS Eyes: Click Element',
    label: 'JS Eyes: Click',
    description: 'Click a page element by CSS selector, XPath, or visible text. Does not require allowRawEval.',
    openclawDescription: '通过 CSS 选择器、XPath 或可见文本点击页面元素。不依赖 allowRawEval。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      selector: { type: 'string', maxLength: 2000, description: 'CSS selector or XPath' },
      text: { type: 'string', maxLength: 2000, description: 'Optional visible text match' },
      index: { type: 'integer', minimum: 0, description: 'Match index when multiple elements match' },
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
    }, ['tabId'], {
      anyOf: [
        { required: ['selector'] },
        { required: ['text'] },
      ],
    }),
    annotations: Object.freeze({ openWorld: true }),
  },
  {
    id: 'page.fill',
    wireAction: 'fill',
    sdkMethod: 'fill',
    openclawAction: 'browser/fill',
    mcpTool: 'browser_fill',
    capability: 'browser.page.interact',
    risk: 'interactive',
    routing: 'extension',
    profiles: Object.freeze(['safe', 'full']),
    title: 'JS Eyes: Fill Form Field',
    label: 'JS Eyes: Fill',
    description: 'Fill an input, textarea, select, or contenteditable element. Does not require allowRawEval.',
    openclawDescription: '填写 input/textarea/select 或 contenteditable。不依赖 allowRawEval。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      selector: { type: 'string', minLength: 1, maxLength: 2000 },
      value: { type: 'string', maxLength: 100000 },
      clearFirst: { type: 'boolean' },
      index: { type: 'integer', minimum: 0 },
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
    }, ['tabId', 'selector', 'value']),
    annotations: Object.freeze({ openWorld: true }),
  },
  {
    id: 'page.scroll',
    wireAction: 'scroll',
    sdkMethod: 'scroll',
    openclawAction: 'browser/scroll',
    mcpTool: 'browser_scroll',
    capability: 'browser.page.interact',
    risk: 'interactive',
    routing: 'extension',
    profiles: Object.freeze(['safe', 'full']),
    title: 'JS Eyes: Scroll Page',
    label: 'JS Eyes: Scroll',
    description: 'Scroll the page to top/bottom, by pixels, or to an element. Does not require allowRawEval.',
    openclawDescription: '滚动到顶部/底部、按像素滚动，或滚动到指定元素。不依赖 allowRawEval。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      scrollTarget: {
        type: 'string',
        enum: Object.freeze(['top', 'bottom']),
        description: 'Scroll to top or bottom when selector/pixels omitted',
      },
      selector: { type: 'string', maxLength: 2000 },
      pixels: { type: 'number' },
      target: TARGET_PROP,
      timeout: TIMEOUT_PROP,
    }, ['tabId']),
    annotations: Object.freeze({ openWorld: true }),
  },
  {
    id: 'page.waitFor',
    wireAction: 'wait_for',
    sdkMethod: 'waitFor',
    openclawAction: 'browser/wait-for',
    mcpTool: 'browser_wait_for',
    capability: 'browser.page.interact',
    risk: 'interactive',
    routing: 'extension',
    profiles: Object.freeze(['safe', 'full']),
    title: 'JS Eyes: Wait For Selector',
    label: 'JS Eyes: Wait For',
    description: 'Wait until a CSS selector matches (optionally visible). Does not require allowRawEval.',
    openclawDescription: '等待 CSS 选择器出现（可选要求可见）。不依赖 allowRawEval。',
    inputSchema: objectSchema({
      tabId: TAB_ID_PROP,
      selector: { type: 'string', minLength: 1, maxLength: 2000 },
      timeout: { type: 'number', exclusiveMinimum: 0, maximum: 1800, description: 'Wait timeout in seconds' },
      visible: { type: 'boolean' },
      target: TARGET_PROP,
    }, ['tabId', 'selector']),
    annotations: Object.freeze({ openWorld: true }),
  },
].map((operation) => Object.freeze(operation)));

const BROWSER_OPERATION_BY_WIRE_ACTION = Object.freeze(Object.fromEntries(
  BROWSER_OPERATIONS.map((operation) => [operation.wireAction, operation]),
));

const BROWSER_OPERATION_BY_ID = Object.freeze(Object.fromEntries(
  BROWSER_OPERATIONS.map((operation) => [operation.id, operation]),
));

const BROWSER_OPERATION_BY_OPENCLAW_ACTION = Object.freeze(Object.fromEntries(
  BROWSER_OPERATIONS
    .filter((operation) => operation.openclawAction)
    .map((operation) => [operation.openclawAction, operation]),
));

const BROWSER_OPERATION_BY_MCP_TOOL = Object.freeze(Object.fromEntries(
  BROWSER_OPERATIONS
    .filter((operation) => operation.mcpTool)
    .map((operation) => [operation.mcpTool, operation]),
));

const FORWARDABLE_ACTIONS = Object.freeze(BROWSER_OPERATIONS
  .filter((operation) => operation.routing === 'extension')
  .map((operation) => operation.wireAction));

const SENSITIVE_BROWSER_ACTIONS = Object.freeze(BROWSER_OPERATIONS
  .filter((operation) => operation.sensitive)
  .map((operation) => operation.wireAction));

const SENSITIVE_BROWSER_TOOL_NAMES = Object.freeze(BROWSER_OPERATIONS
  .filter((operation) => operation.sensitive && operation.openclawAction)
  .map((operation) => operation.openclawAction));

const ACTION_POLICY_TOOL_MAP = Object.freeze(Object.fromEntries(
  BROWSER_OPERATIONS
    .filter((operation) => operation.policyTool)
    .map((operation) => [operation.wireAction, operation.policyTool]),
));

function listBrowserOperationsForProfile(profile = 'safe') {
  const normalized = profile === 'full' ? 'full' : 'safe';
  return BROWSER_OPERATIONS.filter((operation) => (operation.profiles || []).includes(normalized));
}

module.exports = {
  ACTION_POLICY_TOOL_MAP,
  BROWSER_OPERATIONS,
  BROWSER_OPERATION_BY_ID,
  BROWSER_OPERATION_BY_MCP_TOOL,
  BROWSER_OPERATION_BY_OPENCLAW_ACTION,
  BROWSER_OPERATION_BY_WIRE_ACTION,
  FORWARDABLE_ACTIONS,
  SENSITIVE_BROWSER_ACTIONS,
  SENSITIVE_BROWSER_TOOL_NAMES,
  listBrowserOperationsForProfile,
};
