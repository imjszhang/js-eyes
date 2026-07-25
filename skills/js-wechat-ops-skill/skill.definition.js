'use strict';

const pkg = require('./package.json');
const { createDefinitionEnvelope } = require('@js-eyes/skill-scaffold');
const { BrowserAutomation } = require('@js-eyes/client-sdk');
const { getArticle } = require('./lib/api');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');

const CLI_COMMANDS = [
  { name: 'article', description: '读取微信公众号文章详情' },
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
    name: 'wechat_get_article',
    risk: 'read',
    capabilities: ['browser.tabs.read', 'browser.page.read', 'browser.navigation', 'browser.script.execute'],
    label: 'WeChat Ops: Get Article',
    description: '读取微信公众号文章详情，返回标题、作者、摘要、正文、头图和图片列表。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '微信公众号文章 URL' },
      },
      required: ['url'],
    },
    optional: true,
    async execute(runtime, params, context = {}) {
      return getArticle(runtime.ensureBot(), params.url, {
        browserServer: runtime.config.serverUrl,
        recording: runtime.config.recording,
        runId: context.toolCallId,
      });
    },
  },
];

module.exports = createDefinitionEnvelope({
  pkg,
  displayName: 'JS WeChat Ops Skill',
  capabilities: {
    browser: ['tabs.read', 'page.read', 'navigation', 'script.execute'],
    network: { direct: false, hosts: [] },
    filesystem: ['skillData'],
    process: [],
    secrets: [],
    background: false,
  },
  requirements: {
    server: true,
    browserExtension: true,
    login: false,
    platforms: ['mp.weixin.qq.com'],
  },
  tools: TOOL_DEFINITIONS,
  cli: {
    entry: './cli/index.js',
    commands: CLI_COMMANDS,
  },
  extra: { createRuntime },
});
