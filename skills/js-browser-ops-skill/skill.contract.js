'use strict';

const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const {
  readPage,
  clickElement,
  fillForm,
  waitFor,
  scrollPage,
  takeScreenshot,
} = require('./lib/api');
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
  let bot = null;

  return {
    config: runtimeConfig,
    logger: resolvedLogger,
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
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'browser_read_page',
    label: 'Browser Ops: Read Page',
    description: '读取任意网页正文内容，返回结构化的 markdown/纯文本 + 元数据（标题、作者、摘要、图片、链接）。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要读取的网页 URL（传入则打开新标签页）' },
        tabId: { type: 'number', description: '已打开的标签页 ID（与 url 二选一）' },
        format: {
          type: 'string',
          enum: ['markdown', 'text', 'html'],
          description: '返回格式（默认 markdown）',
        },
      },
    },
    optional: true,
    async execute(runtime, params, context = {}) {
      return readPage(runtime.ensureBot(), params, {
        recording: runtime.config.recording,
        runId: context.toolCallId,
      });
    },
  },
  {
    name: 'browser_click',
    label: 'Browser Ops: Click',
    description: '点击页面元素。支持 CSS 选择器、XPath 或文本内容匹配。',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '标签页 ID' },
        selector: { type: 'string', description: 'CSS 选择器或 XPath' },
        text: { type: 'string', description: '按文本内容匹配元素（与 selector 配合使用）' },
        index: { type: 'number', description: '匹配到多个元素时选择第几个（从 0 开始，默认 0）' },
      },
      required: ['tabId'],
    },
    optional: true,
    async execute(runtime, params) {
      return clickElement(runtime.ensureBot(), params);
    },
  },
  {
    name: 'browser_fill_form',
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
      },
      required: ['tabId', 'selector', 'value'],
    },
    optional: true,
    async execute(runtime, params) {
      return fillForm(runtime.ensureBot(), params);
    },
  },
  {
    name: 'browser_wait_for',
    label: 'Browser Ops: Wait For',
    description: '等待页面元素出现或条件满足。使用 MutationObserver 高效监听。',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '标签页 ID' },
        selector: { type: 'string', description: '等待出现的元素 CSS 选择器' },
        timeout: { type: 'number', description: '超时秒数（默认 10）' },
        visible: { type: 'boolean', description: '是否要求元素可见（有宽高）' },
      },
      required: ['tabId', 'selector'],
    },
    optional: true,
    async execute(runtime, params) {
      return waitFor(runtime.ensureBot(), params);
    },
  },
  {
    name: 'browser_scroll',
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
      },
      required: ['tabId'],
    },
    optional: true,
    async execute(runtime, params) {
      return scrollPage(runtime.ensureBot(), params);
    },
  },
  {
    name: 'browser_screenshot',
    label: 'Browser Ops: Screenshot',
    description: '获取页面视口信息和截图元数据。',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '标签页 ID' },
      },
      required: ['tabId'],
    },
    optional: true,
    async execute(runtime, params) {
      return takeScreenshot(runtime.ensureBot(), params);
    },
  },
];

function createOpenClawAdapter(config = {}, logger) {
  const runtime = createRuntime(config, logger);
  return {
    runtime,
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      optional: tool.optional,
      async execute(toolCallId, params) {
        const result = await tool.execute(runtime, params, { toolCallId });
        return runtime.jsonResult(result);
      },
    })),
  };
}

module.exports = {
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
  openclaw: {
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      optional: tool.optional,
    })),
  },
  createRuntime,
  createOpenClawAdapter,
};
