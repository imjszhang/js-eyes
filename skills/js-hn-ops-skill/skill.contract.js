'use strict';

const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { runTool } = require('./lib/runTool');
const { Session } = require('./lib/session');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');
const { PAGE_PROFILES } = require('./lib/config');
const targets = require('./lib/toolTargets');

const CLI_COMMANDS = [
  { name: 'doctor', description: '连通性 + bridge + probe + state 诊断' },
  { name: 'front', description: '首页列表' },
  { name: 'item', description: '帖子详情 + 评论' },
  { name: 'user', description: '用户页' },
  { name: 'search', description: 'Algolia 搜索' },
  { name: 'session-state', description: '登录态' },
  { name: 'navigate-front', description: '导航首页（INTERACTIVE）' },
  { name: 'navigate-item', description: '导航帖子（INTERACTIVE）' },
  { name: 'navigate-user', description: '导航用户（INTERACTIVE）' },
  { name: 'navigate-search', description: '导航搜索相关页（INTERACTIVE）' },
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
    pages: Object.keys(PAGE_PROFILES),
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
    textResult(text) { return { content: [{ type: 'text', text }] }; },
    jsonResult(value) { return this.textResult(JSON.stringify(value, null, 2)); },
    dispose() {
      if (bot && typeof bot.disconnect === 'function') {
        try { bot.disconnect(); } catch (_) {}
      }
      bot = null;
    },
  };
}

function makeReadToolExecutor({ pageKey, method, toolName, buildTargetUrl, cmdDef }) {
  return async function execute(runtime, params, context = {}) {
    const targetUrl = typeof buildTargetUrl === 'function' ? buildTargetUrl(params || {}) : null;
    return runTool(runtime.ensureBot(), {
      toolName,
      pageKey,
      method,
      args: params || {},
      targetUrl,
      cmdDef,
      options: {
        wsEndpoint: runtime.config.serverUrl,
        recording: runtime.config.recording,
        runId: context.toolCallId,
        readMode: (params && params.readMode) || undefined,
        navigateOnReuse: false,
        reuseAnyHnTab: true,
        createUrl: targetUrl || 'https://news.ycombinator.com/news',
      },
    });
  };
}

function makeNavigateToolExecutor({ pageKey, method, toolName }) {
  return async function execute(runtime, params, context = {}) {
    const startedAt = Date.now();
    const session = new Session({
      opts: {
        page: pageKey,
        bot: runtime.ensureBot(),
        verbose: false,
        wsEndpoint: runtime.config.serverUrl,
        createIfMissing: true,
        navigateOnReuse: false,
        reuseAnyHnTab: true,
        createUrl: 'https://news.ycombinator.com/news',
      },
    });
    try {
      await session.connect();
      await session.resolveTarget();
      await session.ensureBridge();
      const navResp = await session.callApi(method, [params || {}]);
      if (!navResp || !navResp.ok) {
        return {
          platform: 'hackernews',
          toolName,
          pageKey,
          method,
          ok: false,
          interactive: true,
          destructive: false,
          run: { durationMs: Date.now() - startedAt, runId: context.toolCallId || null },
          nav: navResp || null,
          postState: null,
        };
      }
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
        platform: 'hackernews',
        toolName,
        pageKey,
        method,
        ok: !!postState.ready,
        interactive: true,
        destructive: false,
        run: { durationMs: Date.now() - startedAt, runId: context.toolCallId || null },
        nav: navResp,
        postState,
      };
    } finally {
      await session.close();
    }
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'hn_session_state',
    label: 'HN Ops: Session State',
    description: '读取浏览器当前 HN 页推断的登录态',
    parameters: { type: 'object', properties: {}, required: [] },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'front',
    method: 'sessionState',
    execute: makeReadToolExecutor({
      toolName: 'hn_session_state',
      pageKey: 'front',
      method: 'sessionState',
      buildTargetUrl: () => null,
    }),
  },
  {
    name: 'hn_get_front_page',
    label: 'HN Ops: Front Page',
    description: '读取 HN 首页列表（Firebase API + DOM 兜底）',
    parameters: {
      type: 'object',
      properties: {
        feed: { type: 'string', enum: ['top', 'new', 'best', 'ask', 'show', 'job'], default: 'top' },
        page: { type: 'number', description: '分页 ?p=N，默认 1' },
        limit: { type: 'number', description: '条数，默认 30，最大 100' },
        readMode: { type: 'string', enum: ['auto', 'api', 'dom'] },
      },
      required: [],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'front',
    method: 'getFrontPage',
    execute: makeReadToolExecutor({
      toolName: 'hn_get_front_page',
      pageKey: 'front',
      method: 'getFrontPage',
      buildTargetUrl: (p) => targets.frontUrl(p),
      cmdDef: { domSupported: true, apiSupported: true, defaultReadMode: 'auto' },
    }),
  },
  {
    name: 'hn_get_item',
    label: 'HN Ops: Get Item',
    description: '读取帖子详情与评论树（Firebase 递归 kids + DOM 兜底）',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'number' },
        url: { type: 'string' },
        depth: { type: 'number', description: '评论树深度，默认 6' },
        commentLimit: { type: 'number', description: '评论数量上限，默认 200' },
        readMode: { type: 'string', enum: ['auto', 'api', 'dom'] },
      },
      required: [],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'item',
    method: 'getItem',
    execute: makeReadToolExecutor({
      toolName: 'hn_get_item',
      pageKey: 'item',
      method: 'getItem',
      buildTargetUrl: (p) => targets.itemUrl(p),
      cmdDef: { domSupported: true, apiSupported: true, defaultReadMode: 'auto' },
    }),
  },
  {
    name: 'hn_get_user',
    label: 'HN Ops: Get User',
    description: '读取用户资料与提交/评论列表',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        tab: { type: 'string', enum: ['submitted', 'comments'], default: 'submitted' },
        limit: { type: 'number' },
        readMode: { type: 'string', enum: ['auto', 'api', 'dom'] },
      },
      required: [],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'user',
    method: 'getUser',
    execute: makeReadToolExecutor({
      toolName: 'hn_get_user',
      pageKey: 'user',
      method: 'getUser',
      buildTargetUrl: (p) => targets.userUrl(p),
      cmdDef: { domSupported: true, apiSupported: true, defaultReadMode: 'auto' },
    }),
  },
  {
    name: 'hn_search',
    label: 'HN Ops: Search',
    description: 'Algolia 搜索 HN（hn.algolia.com）',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        tags: { type: 'string' },
        sort: { type: 'string', enum: ['relevance', 'date'] },
        page: { type: 'number' },
        limit: { type: 'number' },
        readMode: { type: 'string', enum: ['api'] },
      },
      required: ['query'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'search',
    method: 'search',
    execute: makeReadToolExecutor({
      toolName: 'hn_search',
      pageKey: 'search',
      method: 'search',
      buildTargetUrl: () => null,
      cmdDef: { domSupported: false, apiSupported: true, defaultReadMode: 'api' },
    }),
  },
  {
    name: 'hn_navigate_front',
    label: 'HN Ops: Navigate Front',
    description: '仅 location.assign 到首页 feed',
    parameters: {
      type: 'object',
      properties: {
        feed: { type: 'string', enum: ['top', 'new', 'best', 'ask', 'show', 'job'] },
        page: { type: 'number' },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'front',
    method: 'navigateFront',
    execute: makeNavigateToolExecutor({ toolName: 'hn_navigate_front', pageKey: 'front', method: 'navigateFront' }),
  },
  {
    name: 'hn_navigate_item',
    label: 'HN Ops: Navigate Item',
    description: '仅 location.assign 到帖子页',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'number' },
        url: { type: 'string' },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'item',
    method: 'navigateItem',
    execute: makeNavigateToolExecutor({ toolName: 'hn_navigate_item', pageKey: 'item', method: 'navigateItem' }),
  },
  {
    name: 'hn_navigate_user',
    label: 'HN Ops: Navigate User',
    description: '仅 location.assign 到用户页',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        tab: { type: 'string', enum: ['submitted', 'comments'] },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'user',
    method: 'navigateUser',
    execute: makeNavigateToolExecutor({ toolName: 'hn_navigate_user', pageKey: 'user', method: 'navigateUser' }),
  },
  {
    name: 'hn_navigate_search',
    label: 'HN Ops: Navigate Search',
    description: 'HN 无同源搜索页；打开 /news（请用 hn_search 走 Algolia）',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'search',
    method: 'navigateSearch',
    execute: makeNavigateToolExecutor({ toolName: 'hn_navigate_search', pageKey: 'search', method: 'navigateSearch' }),
  },
];

function projectTool(tool) {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    optional: tool.optional === true,
    interactive: tool.interactive === true,
    destructive: tool.destructive === true,
  };
}

function createOpenClawAdapter(config = {}, logger) {
  const runtime = createRuntime(config, logger);
  return {
    runtime,
    tools: TOOL_DEFINITIONS.map((tool) => Object.assign(projectTool(tool), {
      async execute(toolCallId, params) {
        const result = await tool.execute(runtime, params, { toolCallId });
        return runtime.jsonResult(result);
      },
    })),
  };
}

module.exports = {
  id: pkg.name,
  name: 'JS Hacker News Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    platforms: ['news.ycombinator.com'],
    pageProfiles: Object.keys(PAGE_PROFILES),
  },
  cli: {
    entry: './cli/index.js',
    commands: CLI_COMMANDS,
  },
  openclaw: {
    tools: TOOL_DEFINITIONS.map(projectTool),
  },
  createRuntime,
  createOpenClawAdapter,
  TOOL_DEFINITIONS,
};
