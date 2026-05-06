'use strict';

const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');
const { runTool } = require('./lib/runTool');
const { Session } = require('./lib/session');
const { COMMANDS } = require('./lib/commands');
const targets = require('./lib/toolTargets');
const { MONITOR_TOOL_DEFINITIONS } = require('./lib/runMonitor');

const CLI_COMMANDS = Object.entries(COMMANDS)
  .filter(([, def]) => def.help)
  .map(([name, def]) => ({ name, description: def.help || '' }));

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
    name: 'zhihu_get_answer',
    label: 'Zhihu Ops: Get Answer',
    description: '读取知乎回答详情，返回标题、作者、正文、点赞和评论数。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '知乎回答 URL' },
        readMode: { type: 'string', enum: ['auto', 'dom', 'api'], description: '读取模式（当前默认 dom）' },
      },
      required: ['url'],
    },
    optional: true,
    execute: makeReadToolExecutor({
      toolName: 'zhihu_get_answer',
      pageKey: 'answer',
      method: 'getAnswer',
      cmdDef: { methodBase: 'getAnswer', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
      toArgs: (p) => ({ url: p.url }),
      toTargetUrl: (p) => targets.answerUrl({ url: p.url }),
      timeoutMs: 90000,
    }),
  },
  {
    name: 'zhihu_get_article',
    label: 'Zhihu Ops: Get Article',
    description: '读取知乎专栏详情，返回标题、作者、发布时间和正文。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '知乎专栏 URL' },
        readMode: { type: 'string', enum: ['auto', 'dom', 'api'], description: '读取模式（当前默认 dom）' },
      },
      required: ['url'],
    },
    optional: true,
    execute: makeReadToolExecutor({
      toolName: 'zhihu_get_article',
      pageKey: 'article',
      method: 'getArticle',
      cmdDef: { methodBase: 'getArticle', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
      toArgs: (p) => ({ url: p.url }),
      toTargetUrl: (p) => targets.articleUrl({ url: p.url }),
      timeoutMs: 90000,
    }),
  },
  {
    name: 'zhihu_session_state',
    label: 'Zhihu Ops: Session State',
    description: '读取知乎登录态、cookie 标记与页面阻断状态。',
    interactive: false,
    destructive: false,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: makeReadToolExecutor({
      toolName: 'zhihu_session_state',
      pageKey: 'home',
      method: 'sessionState',
      cmdDef: { legacyOnly: true },
      toArgs: () => ({}),
      toTargetUrl: () => null,
      timeoutMs: 30000,
    }),
  },
  {
    name: 'zhihu_get_question_answers',
    label: 'Zhihu Ops: Get Question Answers',
    description: '读取知乎问题页标题、描述与回答列表摘要。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '知乎问题 URL（与 questionId 二选一）' },
        questionId: { type: 'string', description: '知乎问题 ID' },
        limit: { type: 'number', description: '回答数上限（默认 10，最多 100）' },
      },
    },
    execute: makeReadToolExecutor({
      toolName: 'zhihu_get_question_answers',
      pageKey: 'question',
      method: 'getQuestionAnswers',
      cmdDef: { methodBase: 'getQuestionAnswers', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
      toArgs: (p) => ({ url: p.url, questionId: p.questionId, limit: p.limit }),
      toTargetUrl: (p) => targets.questionUrl({ url: p.url, questionId: p.questionId }),
      timeoutMs: 180000,
    }),
  },
  {
    name: 'zhihu_search',
    label: 'Zhihu Ops: Search',
    description: '知乎搜索结果读取（DOM 路径，支持关键词、类型和 limit）。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        type: { type: 'string', description: '搜索类型（如 content/people/topic，按知乎当前 URL 参数透传）' },
        limit: { type: 'number', description: '结果数上限（默认 10，最多 100）' },
      },
      required: ['keyword'],
    },
    execute: makeReadToolExecutor({
      toolName: 'zhihu_search',
      pageKey: 'search',
      method: 'search',
      cmdDef: { methodBase: 'search', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
      toArgs: (p) => ({ keyword: p.keyword, type: p.type, limit: p.limit }),
      toTargetUrl: (p) => targets.searchUrl({ keyword: p.keyword, type: p.type }),
      timeoutMs: 180000,
    }),
  },
  {
    name: 'zhihu_get_user',
    label: 'Zhihu Ops: Get User',
    description: '读取知乎用户主页资料。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '知乎用户 URL（与 userSlug 二选一）' },
        userSlug: { type: 'string', description: '知乎用户 slug' },
      },
    },
    execute: makeReadToolExecutor({
      toolName: 'zhihu_get_user',
      pageKey: 'user',
      method: 'getUser',
      cmdDef: { methodBase: 'getUser', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
      toArgs: (p) => ({ url: p.url, userSlug: p.userSlug }),
      toTargetUrl: (p) => targets.userUrl({ url: p.url, userSlug: p.userSlug }),
      timeoutMs: 90000,
    }),
  },
  {
    name: 'zhihu_get_user_answers',
    label: 'Zhihu Ops: Get User Answers',
    description: '读取知乎用户主页上的回答列表摘要。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '知乎用户 URL（与 userSlug 二选一）' },
        userSlug: { type: 'string', description: '知乎用户 slug' },
        limit: { type: 'number', description: '结果数上限（默认 10，最多 100）' },
      },
    },
    execute: makeReadToolExecutor({
      toolName: 'zhihu_get_user_answers',
      pageKey: 'user',
      method: 'getUserAnswers',
      cmdDef: { methodBase: 'getUserAnswers', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
      toArgs: (p) => ({ url: p.url, userSlug: p.userSlug, limit: p.limit }),
      toTargetUrl: (p) => targets.userUrl({ url: p.url, userSlug: p.userSlug }),
      timeoutMs: 180000,
    }),
  },
  {
    name: 'zhihu_get_user_articles',
    label: 'Zhihu Ops: Get User Articles',
    description: '读取知乎用户主页上的文章列表摘要。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '知乎用户 URL（与 userSlug 二选一）' },
        userSlug: { type: 'string', description: '知乎用户 slug' },
        limit: { type: 'number', description: '结果数上限（默认 10，最多 100）' },
      },
    },
    execute: makeReadToolExecutor({
      toolName: 'zhihu_get_user_articles',
      pageKey: 'user',
      method: 'getUserArticles',
      cmdDef: { methodBase: 'getUserArticles', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
      toArgs: (p) => ({ url: p.url, userSlug: p.userSlug, limit: p.limit }),
      toTargetUrl: (p) => targets.userUrl({ url: p.url, userSlug: p.userSlug }),
      timeoutMs: 180000,
    }),
  },
  ...makeNavigateTools(),
  ...MONITOR_TOOL_DEFINITIONS,
];

function makeReadToolExecutor(spec) {
  return async function execute(runtime, params, context = {}) {
    return runTool(runtime.ensureBot(), {
      toolName: spec.toolName,
      pageKey: spec.pageKey,
      method: spec.method,
      cmdDef: spec.cmdDef,
      args: spec.toArgs ? spec.toArgs(params || {}) : (params || {}),
      targetUrl: spec.toTargetUrl ? spec.toTargetUrl(params || {}) : null,
      options: {
        wsEndpoint: runtime.config.serverUrl,
        recording: runtime.config.recording,
        runId: context.toolCallId,
        readMode: params && params.readMode,
        timeoutMs: spec.timeoutMs || 90000,
        navigateOnReuse: false,
        reuseAnyZhihuTab: true,
        createUrl: spec.toTargetUrl ? spec.toTargetUrl(params || {}) : 'https://www.zhihu.com/',
      },
    });
  };
}

function makeNavigateToolExecutor(spec) {
  return async function execute(runtime, params) {
    const browser = runtime.ensureBot();
    const session = new Session({
      opts: {
        page: spec.pageKey,
        bot: browser,
        verbose: false,
        wsEndpoint: runtime.config.serverUrl,
        createIfMissing: true,
        navigateOnReuse: false,
        reuseAnyZhihuTab: true,
        createUrl: 'https://www.zhihu.com/',
      },
    });
    const startedAt = Date.now();
    try {
      await session.connect();
      await session.resolveTarget();
      await session.ensureBridge();
      const navResp = await session.callApi(spec.method, [spec.toArgs ? spec.toArgs(params || {}) : (params || {})]);
      if (!navResp || !navResp.ok) return { ok: false, interactive: true, destructive: false, nav: navResp || null };
      const noop = navResp.data && navResp.data.noop === true;
      const fromUrl = navResp.data && navResp.data.from && navResp.data.from.url;
      const expectedUrl = navResp.data && navResp.data.to && navResp.data.to.url;
      const postState = noop
        ? { ready: true, attempts: 0, currentUrl: fromUrl || null, state: null, skipped: 'noop' }
        : await session.awaitBridgeAfterNav({
          timeoutMs: 20000,
          intervalMs: 500,
          initialDelayMs: 400,
          fromUrl: fromUrl || null,
          expectedUrl: expectedUrl || null,
        });
      return {
        platform: 'zhihu',
        toolName: spec.toolName,
        method: spec.method,
        ok: !!postState.ready,
        interactive: true,
        destructive: false,
        run: { durationMs: Date.now() - startedAt },
        nav: navResp,
        postState,
      };
    } finally {
      try { await session.close(); } catch (_) {}
    }
  };
}

function makeNavigateTools() {
  return [
    {
      name: 'zhihu_navigate_answer',
      label: 'Zhihu Ops: Navigate Answer',
      description: '导航到知乎回答页（仅 location.assign）。',
      interactive: true,
      destructive: false,
      parameters: { type: 'object', properties: { url: { type: 'string', description: '知乎回答 URL' } }, required: ['url'] },
      execute: makeNavigateToolExecutor({ toolName: 'zhihu_navigate_answer', pageKey: 'answer', method: 'navigateAnswer', toArgs: (p) => ({ url: p.url }) }),
    },
    {
      name: 'zhihu_navigate_article',
      label: 'Zhihu Ops: Navigate Article',
      description: '导航到知乎专栏页（仅 location.assign）。',
      interactive: true,
      destructive: false,
      parameters: { type: 'object', properties: { url: { type: 'string', description: '知乎专栏 URL' } }, required: ['url'] },
      execute: makeNavigateToolExecutor({ toolName: 'zhihu_navigate_article', pageKey: 'article', method: 'navigateArticle', toArgs: (p) => ({ url: p.url }) }),
    },
    {
      name: 'zhihu_navigate_question',
      label: 'Zhihu Ops: Navigate Question',
      description: '导航到知乎问题页（仅 location.assign）。',
      interactive: true,
      destructive: false,
      parameters: { type: 'object', properties: { url: { type: 'string' }, questionId: { type: 'string' } } },
      execute: makeNavigateToolExecutor({ toolName: 'zhihu_navigate_question', pageKey: 'question', method: 'navigateQuestion', toArgs: (p) => ({ url: p.url, questionId: p.questionId }) }),
    },
    {
      name: 'zhihu_navigate_search',
      label: 'Zhihu Ops: Navigate Search',
      description: '导航到知乎搜索页（仅 location.assign）。',
      interactive: true,
      destructive: false,
      parameters: { type: 'object', properties: { keyword: { type: 'string' }, type: { type: 'string' } } },
      execute: makeNavigateToolExecutor({ toolName: 'zhihu_navigate_search', pageKey: 'search', method: 'navigateSearch', toArgs: (p) => ({ keyword: p.keyword, type: p.type }) }),
    },
    {
      name: 'zhihu_navigate_user',
      label: 'Zhihu Ops: Navigate User',
      description: '导航到知乎用户主页（仅 location.assign）。',
      interactive: true,
      destructive: false,
      parameters: { type: 'object', properties: { url: { type: 'string' }, userSlug: { type: 'string' } } },
      execute: makeNavigateToolExecutor({ toolName: 'zhihu_navigate_user', pageKey: 'user', method: 'navigateUser', toArgs: (p) => ({ url: p.url, userSlug: p.userSlug }) }),
    },
    {
      name: 'zhihu_navigate_home',
      label: 'Zhihu Ops: Navigate Home',
      description: '导航到知乎首页（仅 location.assign）。',
      interactive: true,
      destructive: false,
      parameters: { type: 'object', properties: {} },
      execute: makeNavigateToolExecutor({ toolName: 'zhihu_navigate_home', pageKey: 'home', method: 'navigateHome', toArgs: () => ({}) }),
    },
  ];
}

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
      interactive: !!tool.interactive,
      destructive: !!tool.destructive,
      async execute(toolCallId, params) {
        const result = await tool.execute(runtime, params, { toolCallId });
        return runtime.jsonResult(result);
      },
    })),
  };
}

module.exports = {
  id: pkg.name,
  name: 'JS Zhihu Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    platforms: ['zhihu.com', 'zhuanlan.zhihu.com'],
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
      interactive: !!tool.interactive,
      destructive: !!tool.destructive,
    })),
  },
  tools: TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    optional: tool.optional,
    interactive: !!tool.interactive,
    destructive: !!tool.destructive,
  })),
  TOOL_DEFINITIONS,
  makeReadToolExecutor,
  makeNavigateToolExecutor,
  createRuntime,
  createOpenClawAdapter,
};
