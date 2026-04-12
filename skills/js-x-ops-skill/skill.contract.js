'use strict';

const manifest = require('./openclaw-plugin/openclaw.plugin.json');
const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { searchTweets, getProfileTweets, getPost, getHomeFeed } = require('./lib/api');

const CLI_COMMANDS = [
  { name: 'search', description: '搜索 X 平台内容' },
  { name: 'profile', description: '浏览指定用户主页与时间线' },
  { name: 'post', description: '读取帖子详情或执行发布操作' },
  { name: 'home', description: '浏览首页 Feed' },
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
  const runtimeConfig = {
    serverUrl: config.jsEyesServerUrl || config.serverUrl || 'ws://localhost:18080',
    requestTimeout: Number(config.requestTimeout || 60),
    defaultMaxPages: Number(config.defaultMaxPages || 3),
  };

  let bot = null;

  return {
    config: runtimeConfig,
    ensureBot() {
      if (!bot) {
        bot = new BrowserAutomation(runtimeConfig.serverUrl, {
          defaultTimeout: runtimeConfig.requestTimeout,
          logger: resolvedLogger,
        });
      }
      return bot;
    },
    logger: resolvedLogger,
    textResult(text) {
      return { content: [{ type: 'text', text }] };
    },
    jsonResult(value) {
      return this.textResult(JSON.stringify(value, null, 2));
    },
    dispose() {
      if (bot && typeof bot.disconnect === 'function') {
        try {
          bot.disconnect();
        } catch {
          // ignore best-effort cleanup
        }
      }
      bot = null;
    },
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'x_search_tweets',
    label: 'X Ops: Search Tweets',
    description: '搜索 X.com (Twitter) 内容。支持关键词搜索、排序、日期范围、作者过滤、互动数过滤等。返回结构化帖子数据（含作者、内容、统计、媒体）。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        maxPages: { type: 'number', description: '最多翻页数，每页约20条' },
        sort: { type: 'string', enum: ['top', 'latest', 'media'], description: '排序方式：top（热门）、latest（最新）、media（媒体）' },
        lang: { type: 'string', description: '搜索语言代码（如 zh、en、ja）' },
        from: { type: 'string', description: '指定作者用户名（不带 @）' },
        since: { type: 'string', description: '起始日期 YYYY-MM-DD' },
        until: { type: 'string', description: '截止日期 YYYY-MM-DD' },
        minLikes: { type: 'number', description: '最低点赞数过滤' },
        minRetweets: { type: 'number', description: '最低转发数过滤' },
        excludeReplies: { type: 'boolean', description: '排除回复' },
        excludeRetweets: { type: 'boolean', description: '排除转推' },
      },
      required: ['keyword'],
    },
    optional: true,
    async execute(runtime, params) {
      return searchTweets(runtime.ensureBot(), params.keyword, {
        maxPages: params.maxPages || runtime.config.defaultMaxPages,
        sort: params.sort || 'top',
        lang: params.lang,
        from: params.from,
        since: params.since,
        until: params.until,
        minLikes: params.minLikes || 0,
        minRetweets: params.minRetweets || 0,
        excludeReplies: params.excludeReplies || false,
        excludeRetweets: params.excludeRetweets || false,
        logger: runtime.logger,
      });
    },
  },
  {
    name: 'x_get_profile',
    label: 'X Ops: Get Profile Tweets',
    description: '浏览 X.com 指定用户的主页与时间线内容。返回用户资料和帖子列表。支持翻页、日期筛选、互动数过滤。',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: '用户名（不带 @）' },
        maxPages: { type: 'number', description: '最多翻页数' },
        maxTweets: { type: 'number', description: '最多返回推文数（0 = 不限）' },
        since: { type: 'string', description: '起始日期 YYYY-MM-DD' },
        until: { type: 'string', description: '截止日期 YYYY-MM-DD' },
        includeReplies: { type: 'boolean', description: '是否包含回复' },
        includeRetweets: { type: 'boolean', description: '是否包含转推' },
        minLikes: { type: 'number', description: '最低点赞数过滤' },
      },
      required: ['username'],
    },
    optional: true,
    async execute(runtime, params) {
      return getProfileTweets(runtime.ensureBot(), params.username, {
        maxPages: params.maxPages || runtime.config.defaultMaxPages,
        maxTweets: params.maxTweets || 0,
        since: params.since,
        until: params.until,
        includeReplies: params.includeReplies || false,
        includeRetweets: params.includeRetweets || false,
        minLikes: params.minLikes || 0,
        logger: runtime.logger,
      });
    },
  },
  {
    name: 'x_get_post',
    label: 'X Ops: Get Post Detail',
    description: '读取 X.com 帖子的完整详情，包括内容、统计、媒体。可选获取对话线程和回复；也可作为后续回复、引用等发布流程的输入。',
    parameters: {
      type: 'object',
      properties: {
        tweetUrl: {
          type: 'string',
          description: '推文 URL 或 ID（如 https://x.com/user/status/123 或纯数字 ID）。多条用逗号分隔。',
        },
        withThread: { type: 'boolean', description: '是否获取对话线程（上文）' },
        withReplies: { type: 'number', description: '获取回复数量（0 = 不获取）' },
      },
      required: ['tweetUrl'],
    },
    optional: true,
    async execute(runtime, params) {
      const inputs = params.tweetUrl.split(',').map((item) => item.trim()).filter(Boolean);
      return getPost(runtime.ensureBot(), inputs, {
        withThread: params.withThread || false,
        withReplies: params.withReplies || 0,
        logger: runtime.logger,
      });
    },
  },
  {
    name: 'x_get_home_feed',
    label: 'X Ops: Get Home Feed',
    description: '浏览 X.com 首页 Feed（For You 或 Following）。返回帖子列表，支持翻页和过滤。',
    parameters: {
      type: 'object',
      properties: {
        feed: { type: 'string', enum: ['foryou', 'following'], description: 'Feed 类型：foryou（推荐）或 following（关注）' },
        maxPages: { type: 'number', description: '最多翻页数' },
        maxTweets: { type: 'number', description: '最多返回推文数（0 = 不限）' },
        minLikes: { type: 'number', description: '最低点赞数过滤' },
        excludeReplies: { type: 'boolean', description: '排除回复' },
        excludeRetweets: { type: 'boolean', description: '排除转推' },
      },
    },
    optional: true,
    async execute(runtime, params) {
      return getHomeFeed(runtime.ensureBot(), {
        feed: params.feed || 'foryou',
        maxPages: params.maxPages || runtime.config.defaultMaxPages,
        maxTweets: params.maxTweets || 0,
        minLikes: params.minLikes || 0,
        excludeReplies: params.excludeReplies || false,
        excludeRetweets: params.excludeRetweets || false,
        logger: runtime.logger,
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
  name: manifest.name || 'JS X Ops Skill',
  version: manifest.version || pkg.version,
  description: manifest.description || pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    requiresLogin: true,
    platforms: ['x.com'],
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
