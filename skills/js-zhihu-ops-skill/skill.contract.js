'use strict';

const manifest = require('./openclaw-plugin/openclaw.plugin.json');
const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { getAnswer, getArticle } = require('./lib/api');

const CLI_COMMANDS = [
  { name: 'answer', description: '读取知乎回答详情' },
  { name: 'article', description: '读取知乎专栏详情' },
];

function makeLogger(logger) {
  return {
    info: typeof logger?.info === 'function' ? logger.info.bind(logger) : console.log.bind(console),
    warn: typeof logger?.warn === 'function' ? logger.warn.bind(logger) : console.warn.bind(console),
    error: typeof logger?.error === 'function' ? logger.error.bind(logger) : console.error.bind(console),
  };
}

function createRuntime(config = {}, logger) {
  const runtimeConfig = {
    serverUrl: config.jsEyesServerUrl || config.serverUrl || 'ws://localhost:18080',
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
    name: 'zhihu_get_answer',
    label: 'Zhihu Ops: Get Answer',
    description: '读取知乎回答详情，返回标题、作者、正文、点赞和评论数。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '知乎回答 URL' },
      },
      required: ['url'],
    },
    optional: true,
    async execute(runtime, params) {
      return getAnswer(runtime.ensureBot(), params.url, { browserServer: runtime.config.serverUrl });
    },
  },
  {
    name: 'zhihu_get_article',
    label: 'Zhihu Ops: Get Article',
    description: '读取知乎专栏详情，返回标题、作者、发布时间和正文。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '知乎专栏 URL' },
      },
      required: ['url'],
    },
    optional: true,
    async execute(runtime, params) {
      return getArticle(runtime.ensureBot(), params.url, { browserServer: runtime.config.serverUrl });
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
      async execute(_toolCallId, params) {
        const result = await tool.execute(runtime, params);
        return runtime.jsonResult(result);
      },
    })),
  };
}

module.exports = {
  id: manifest.id,
  name: manifest.name || 'JS Zhihu Ops Skill',
  version: manifest.version || pkg.version,
  description: manifest.description || pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    platforms: ['zhihu.com'],
  },
  cli: {
    entry: './cli/index.js',
    commands: CLI_COMMANDS,
  },
  openclaw: {
    manifestPath: './openclaw-plugin/openclaw.plugin.json',
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
