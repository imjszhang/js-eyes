'use strict';

const manifest = require('./openclaw-plugin/openclaw.plugin.json');
const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { getNote } = require('./lib/api');

const CLI_COMMANDS = [
  { name: 'note', description: '读取小红书笔记详情' },
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
    defaultMaxCommentPages: Number(config.defaultMaxCommentPages || 0),
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
    name: 'xhs_get_note',
    label: 'XHS Ops: Get Note',
    description: '读取小红书笔记详情，返回正文、图片、作者信息和评论。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '小红书笔记 URL' },
        maxCommentPages: { type: 'number', description: '评论翻页数，默认 0 表示不扩展抓取评论分页' },
      },
      required: ['url'],
    },
    optional: true,
    async execute(runtime, params) {
      return getNote(runtime.ensureBot(), params.url, {
        browserServer: runtime.config.serverUrl,
        maxCommentPages: params.maxCommentPages ?? runtime.config.defaultMaxCommentPages,
      });
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
  name: manifest.name || 'JS Xiaohongshu Ops Skill',
  version: manifest.version || pkg.version,
  description: manifest.description || pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    platforms: ['xiaohongshu.com'],
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
