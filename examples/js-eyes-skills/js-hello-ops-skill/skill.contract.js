'use strict';

const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');
const { getTitle } = require('./scripts/hello');

const CLI_COMMANDS = [
  { name: 'title', description: '读取指定标签页的标题' },
];

function makeLogger(logger) {
  return {
    info: typeof logger?.info === 'function' ? logger.info.bind(logger) : console.log.bind(console),
    warn: typeof logger?.warn === 'function' ? logger.warn.bind(logger) : console.warn.bind(console),
    error: typeof logger?.error === 'function' ? logger.error.bind(logger) : console.error.bind(console),
  };
}

function createRuntime(config = {}, logger) {
  const resolvedLogger = makeLogger(logger);
  const { serverUrl } = resolveRuntimeConfig(config);
  let bot = null;

  return {
    config: { serverUrl },
    logger: resolvedLogger,
    ensureBot() {
      if (!bot) {
        bot = new BrowserAutomation(serverUrl, { logger: resolvedLogger });
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
    name: 'hello_get_title',
    label: 'Hello Ops: Get Page Title',
    description: '读取指定标签页的 title 与 url。用于演示 JS Eyes Skills 最小契约。',
    parameters: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: '标签页 ID（通过 js_eyes_get_tabs 获取）' },
        target: { type: 'string', description: '目标浏览器 clientId 或名称（如 firefox/chrome）' },
      },
      required: ['tabId'],
    },
    optional: true,
    async execute(runtime, params) {
      return getTitle(runtime.ensureBot(), params);
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
  name: 'JS Hello Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    requiresLogin: false,
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
