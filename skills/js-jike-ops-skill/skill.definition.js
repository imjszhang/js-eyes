'use strict';

// Shared declarative metadata for the CLI and the native V2 entry.

const pkg = require('./package.json');
const { BrowserAutomation } = require('@js-eyes/client-sdk');
const { getPost } = require('./lib/api');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');

const CLI_COMMANDS = [
  { name: 'post', description: '读取即刻帖子详情' },
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
    dispose() {
      if (bot && typeof bot.disconnect === 'function') {
        try { bot.disconnect(); } catch {}
      }
      bot = null;
    },
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'jike_get_post',
    risk: 'read',
    capabilities: ["browser.tabs.read","browser.page.read","browser.navigation","browser.script.execute"],
    label: 'Jike Ops: Get Post',
    description: '读取即刻帖子详情，返回正文、图片、作者、互动数据和评论。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '即刻帖子 URL' },
      },
      required: ['url'],
    },
    optional: true,
    async execute(runtime, params, context = {}) {
      return getPost(runtime.ensureBot(), params.url, {
        browserServer: runtime.config.serverUrl,
        recording: runtime.config.recording,
        runId: context.toolCallId,
      });
    },
  },
];



const skillCapabilities = {
  "browser": [
    "tabs.read",
    "page.read",
    "navigation",
    "script.execute"
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
    "okjike.com"
  ]
};

module.exports = {
  capabilities: skillCapabilities,
  requirements: skillRequirements,
  id: pkg.name,
  name: 'JS Jike Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    platforms: ['okjike.com'],
  },
  cli: {
    entry: './cli/index.js',
    commands: CLI_COMMANDS,
  },
  createRuntime,
  TOOL_DEFINITIONS,
};
