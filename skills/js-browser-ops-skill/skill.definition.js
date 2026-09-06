'use strict';

// Shared declarative metadata for the CLI and the native V2 entry.

const pkg = require('./package.json');
const { BrowserAutomation } = require('@js-eyes/client-sdk');
const {
  readPage,
  clickElement,
  fillForm,
  waitFor,
  scrollPage,
  takeScreenshot,
  cleanupTabSession,
} = require('./lib/api');
const { createTabSession } = require('./lib/tabSession');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');

const CLI_COMMANDS = [
  { name: 'read', description: '读取任意网页正文内容' },
  { name: 'interact', description: 'DOM 交互操作（click / fill / scroll / wait）' },
];

function makeLogger(logger) {
  return {
    info: typeof logger?.info === 'function' ? logger.info.bind(logger) : console.log.bind(console),
    warn: typeof logger?.warn === 'function' ? logger.warn.bind(logger) : console.warn.bind(console),
    error: typeof logger?.error === 'function' ? logger.error.bind(logger) : console.error.bind(console),
  };
}

function createRuntime(config = {}, logger) {
  const resolvedConfig = resolveRuntimeConfig(config);
  const runtimeConfig = {
    serverUrl: resolvedConfig.serverUrl,
    recording: resolvedConfig.recording,
  };
  const resolvedLogger = makeLogger(logger);
  const tabSession = createTabSession();
  let bot = null;

  return {
    config: runtimeConfig,
    logger: resolvedLogger,
    tabSession,
    ensureBot() {
      if (!bot) {
        bot = new BrowserAutomation(runtimeConfig.serverUrl, { logger: resolvedLogger });
      }
      return bot;
    },
    textResult(text) {
      return { content: [{ type: 'text', text }] };
    },
    jsonResult(value) {
      return this.textResult(JSON.stringify(value, null, 2));
    },
    async dispose() {
      if (bot) {
        try { await cleanupTabSession(bot, { tabSession }); } catch {}
        if (typeof bot.disconnect === 'function') {
          try { bot.disconnect(); } catch {}
        }
      }
      bot = null;
    },
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'browser_read_page',
    risk: 'read',
    capabilities: ["browser.tabs.read","browser.page.read","browser.navigation","browser.script.execute"],
    label: 'Browser Ops: Read Page',
    description: '读取任意网页正文内容，返回结构化的 markdown/纯文本 + 元数据（标题、作者、摘要、图片、链接）。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要读取的网页 URL；与 tabId 同时传入时在该标签页内导航' },
        tabId: { type: 'number', description: '已打开的标签页 ID。默认只能操作本 session 打开的标签；外部标签需 allowExternalTab' },
        format: {
          type: 'string',
          enum: ['markdown', 'text', 'html'],
          description: '返回格式（默认 markdown）',
        },
        keepOpen: {
          type: 'boolean',
          description: '自开标签读完后是否保留。默认 false，读完关闭且 tabId 为 null',
        },
        closeAfter: {
          type: 'boolean',
          description: '与 keepOpen 互斥。true 表示读完关闭；false 等价于 keepOpen',
        },
        allowExternalTab: {
          type: 'boolean',
          description: '是否允许操作本 session 未打开的标签页（默认 false）',
        },
        autoAllowDomain: {
          type: 'boolean',
          description: '显式 opt-in：给当前会话临时授权该域名，不写配置（默认 false，未授权直接 policy_denied）',
        },
        persistAllowDomain: {
          type: 'boolean',
          description: '显式把域名写入持久 egressAllowlist，并要求服务端热加载成功后才导航',
        },
        allowPrivateNetwork: {
          type: 'boolean',
          description: '二次确认后才允许访问回环/私网/链路本地地址',
        },
      },
    },
    optional: true,
    async execute(runtime, params, context = {}) {
      return readPage(runtime.ensureBot(), params, {
        recording: runtime.config.recording,
        runId: context.toolCallId,
        tabSession: runtime.tabSession,
        autoAllowDomain: params.autoAllowDomain === true,
        persistAllowDomain: params.persistAllowDomain === true,
        allowPrivateNetwork: params.allowPrivateNetwork === true,
        keepOpen: params.keepOpen,
        closeAfter: params.closeAfter,
        allowExternalTab: params.allowExternalTab === true,
      });
    },
  },
  {
    name: 'browser_click',
    risk: 'interactive',
    capabilities: ["browser.tabs.read","browser.page.read","browser.navigation","browser.page.interact"],
    label: 'Browser Ops: Click',
    description: '点击页面元素。支持 CSS 选择器、XPath 或文本内容匹配。',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '标签页 ID' },
        selector: { type: 'string', description: 'CSS 选择器或 XPath' },
        text: { type: 'string', description: '按文本内容匹配元素（与 selector 配合使用）' },
        index: { type: 'number', description: '匹配到多个元素时选择第几个（从 0 开始，默认 0）' },
        allowExternalTab: {
          type: 'boolean',
          description: '是否允许操作本 session 未打开的标签页（默认 false）',
        },
      },
      required: ['tabId'],
    },
    optional: true,
    async execute(runtime, params) {
      return clickElement(runtime.ensureBot(), params, {
        tabSession: runtime.tabSession,
        allowExternalTab: params.allowExternalTab === true,
      });
    },
  },
  {
    name: 'browser_fill_form',
    risk: 'interactive',
    capabilities: ["browser.tabs.read","browser.page.read","browser.navigation","browser.page.interact"],
    label: 'Browser Ops: Fill Form',
    description: '填写表单字段。支持 input、textarea、select 和 contenteditable 元素。',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '标签页 ID' },
        selector: { type: 'string', description: '目标元素的 CSS 选择器' },
        value: { type: 'string', description: '要填入的值' },
        clearFirst: { type: 'boolean', description: '填写前是否清空已有内容（默认 false）' },
        index: { type: 'number', description: '匹配到多个元素时选择第几个（从 0 开始）' },
        allowExternalTab: {
          type: 'boolean',
          description: '是否允许操作本 session 未打开的标签页（默认 false）',
        },
      },
      required: ['tabId', 'selector', 'value'],
    },
    optional: true,
    async execute(runtime, params) {
      return fillForm(runtime.ensureBot(), params, {
        tabSession: runtime.tabSession,
        allowExternalTab: params.allowExternalTab === true,
      });
    },
  },
  {
    name: 'browser_wait_for',
    risk: 'read',
    capabilities: ["browser.tabs.read","browser.page.read","browser.navigation","browser.page.interact"],
    label: 'Browser Ops: Wait For',
    description: '等待页面元素出现或条件满足。使用 MutationObserver 高效监听。',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '标签页 ID' },
        selector: { type: 'string', description: '等待出现的元素 CSS 选择器' },
        timeout: { type: 'number', description: '超时秒数（默认 10）' },
        visible: { type: 'boolean', description: '是否要求元素可见（有宽高）' },
        allowExternalTab: {
          type: 'boolean',
          description: '是否允许操作本 session 未打开的标签页（默认 false）',
        },
      },
      required: ['tabId', 'selector'],
    },
    optional: true,
    async execute(runtime, params) {
      return waitFor(runtime.ensureBot(), params, {
        tabSession: runtime.tabSession,
        allowExternalTab: params.allowExternalTab === true,
      });
    },
  },
  {
    name: 'browser_scroll',
    risk: 'interactive',
    capabilities: ["browser.tabs.read","browser.page.read","browser.navigation","browser.page.interact"],
    label: 'Browser Ops: Scroll',
    description: '页面滚动。支持滚动到顶部/底部、指定元素或指定像素偏移。',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '标签页 ID' },
        target: {
          type: 'string',
          enum: ['top', 'bottom'],
          description: '滚动目标（top/bottom）',
        },
        selector: { type: 'string', description: '滚动到指定元素（优先于 target）' },
        pixels: { type: 'number', description: '相对滚动像素数（正数向下，负数向上）' },
        allowExternalTab: {
          type: 'boolean',
          description: '是否允许操作本 session 未打开的标签页（默认 false）',
        },
      },
      required: ['tabId'],
    },
    optional: true,
    async execute(runtime, params) {
      return scrollPage(runtime.ensureBot(), params, {
        tabSession: runtime.tabSession,
        allowExternalTab: params.allowExternalTab === true,
      });
    },
  },
  {
    name: 'browser_screenshot',
    risk: 'read',
    capabilities: ["browser.tabs.read","browser.page.read","browser.navigation","browser.script.execute","browser.screenshot"],
    label: 'Browser Ops: Screenshot',
    description: '截取页面截图。默认截取当前可见区域；Firefox 扩展支持 fullPage=true 长截图。',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '标签页 ID' },
        fullPage: { type: 'boolean', description: '是否截取完整页面（Firefox active tab 支持）' },
        format: { type: 'string', enum: ['png', 'jpeg'], description: '图片格式，默认 png' },
        quality: { type: 'number', description: 'jpeg 质量，0-100' },
        allowExternalTab: {
          type: 'boolean',
          description: '是否允许操作本 session 未打开的标签页（默认 false）',
        },
      },
      required: ['tabId'],
    },
    optional: true,
    async execute(runtime, params) {
      return takeScreenshot(runtime.ensureBot(), params, {
        tabSession: runtime.tabSession,
        allowExternalTab: params.allowExternalTab === true,
      });
    },
  },
  {
    name: 'browser_cleanup_session',
    risk: 'interactive',
    capabilities: ["browser.tabs.read"],
    label: 'Browser Ops: Cleanup Session',
    description: '关闭本 session 仍打开的自开标签页，并取消排队中的打开请求。',
    parameters: {
      type: 'object',
      properties: {},
    },
    optional: true,
    async execute(runtime) {
      return cleanupTabSession(runtime.ensureBot(), { tabSession: runtime.tabSession });
    },
  },
];



const skillCapabilities = {
  "browser": [
    "tabs.read",
    "page.read",
    "navigation",
    "page.interact",
    "script.execute",
    "screenshot"
  ],
  "network": {
    "direct": false,
    "hosts": []
  },
  "filesystem": [
    "skillData"
  ],
  "process": [],
  "secrets": [],
  "background": false
};
const skillRequirements = {
  "server": true,
  "browserExtension": true,
  "login": false,
  "platforms": [
    "*"
  ]
};

module.exports = {
  capabilities: skillCapabilities,
  requirements: skillRequirements,
  id: pkg.name,
  name: 'JS Browser Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    platforms: ['*'],
  },
  cli: {
    entry: './cli/index.js',
    commands: CLI_COMMANDS,
  },
  createRuntime,
  TOOL_DEFINITIONS,
};
