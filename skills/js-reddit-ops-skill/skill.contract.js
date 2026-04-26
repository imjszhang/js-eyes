'use strict';

const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { getPost } = require('./lib/api');
const { runTool } = require('./lib/runTool');
const { Session } = require('./lib/session');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');
const { PAGE_PROFILES } = require('./lib/config');
const targets = require('./lib/toolTargets');

const CLI_COMMANDS = [
  { name: 'post', description: '读取 Reddit 帖子详情' },
  { name: 'doctor', description: '连通性 + 登录态 + bridge 注入 + probe + state 汇总' },
  { name: 'probe', description: '采集页面指纹（按 page profile）' },
  { name: 'state', description: '读取当前 page profile 状态' },
  { name: 'session-state', description: '读取登录态' },
  { name: 'list-subreddit', description: '列出 subreddit 内帖子' },
  { name: 'subreddit-about', description: '读取 subreddit 元信息' },
  { name: 'search', description: '搜索 Reddit' },
  { name: 'user-profile', description: '读取 user 页（overview/submitted/comments/...）' },
  { name: 'inbox-list', description: '读取私信/通知' },
  { name: 'my-feed', description: '读取主 feed / popular / all' },
  { name: 'expand-more', description: '展开评论树 more 节点（/api/morechildren）' },
  { name: 'navigate-post', description: '导航到帖子页（INTERACTIVE）' },
  { name: 'navigate-subreddit', description: '导航到 subreddit（INTERACTIVE）' },
  { name: 'navigate-search', description: '导航到搜索结果（INTERACTIVE）' },
  { name: 'navigate-user', description: '导航到 user 页（INTERACTIVE）' },
  { name: 'navigate-inbox', description: '导航到收件箱（INTERACTIVE）' },
  { name: 'navigate-home', description: '导航到 home/popular/all（INTERACTIVE）' },
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
        try { bot.disconnect(); } catch {}
      }
      bot = null;
    },
  };
}

/**
 * 通用 READ 工具 execute：把 params 传给 lib/runTool.js，
 * 默认 navigateOnReuse=false / reuseAnyRedditTab=true，
 * 任意 reddit tab 都能跑（不会切走用户当前 tab）。
 */
function makeReadToolExecutor({ pageKey, method, toolName, buildTargetUrl }) {
  return async function execute(runtime, params, context = {}) {
    const targetUrl = typeof buildTargetUrl === 'function' ? buildTargetUrl(params || {}) : null;
    return runTool(runtime.ensureBot(), {
      toolName,
      pageKey,
      method,
      args: params || {},
      targetUrl,
      options: {
        wsEndpoint: runtime.config.serverUrl,
        recording: runtime.config.recording,
        runId: context.toolCallId,
        navigateOnReuse: false,
        reuseAnyRedditTab: true,
        createUrl: targetUrl || 'https://www.reddit.com/',
      },
    });
  };
}

/**
 * INTERACTIVE 工具 execute：先 ensureBridge，调 bridge.navigateXxx，
 * 然后 awaitBridgeAfterNav 自校验 state.ready。
 *
 * 安全约束：
 *   - 仅使用 location.assign，不模拟点击
 *   - 不带任何写参数（vote / submit / comment / save 等都不会被透传）
 *   - 跨域 URL 在 bridge 端被 navigateLocation 拒绝
 */
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
        reuseAnyRedditTab: true,
        createUrl: 'https://www.reddit.com/',
      },
    });
    try {
      await session.connect();
      await session.resolveTarget();
      await session.ensureBridge();
      const navResp = await session.callApi(method, [params || {}]);
      if (!navResp || !navResp.ok) {
        return {
          platform: 'reddit',
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
        platform: 'reddit',
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
    name: 'reddit_get_post',
    label: 'Reddit Ops: Get Post',
    description: '读取 Reddit 帖子详情，返回正文、subreddit、图片和评论树。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Reddit 帖子 URL' },
      },
      required: ['url'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'post',
    method: 'getPost',
    async execute(runtime, params, context = {}) {
      return getPost(runtime.ensureBot(), params.url, {
        browserServer: runtime.config.serverUrl,
        recording: runtime.config.recording,
        runId: context.toolCallId,
      });
    },
  },
  {
    name: 'reddit_session_state',
    label: 'Reddit Ops: Session State',
    description: '读取当前浏览器中 Reddit 的登录态（/api/v1/me.json，未登录回 {loggedIn:false}）',
    parameters: { type: 'object', properties: {}, required: [] },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'home',
    method: 'sessionState',
    execute: makeReadToolExecutor({
      toolName: 'reddit_session_state',
      pageKey: 'home',
      method: 'sessionState',
      buildTargetUrl: () => null,
    }),
  },
  {
    name: 'reddit_list_subreddit',
    label: 'Reddit Ops: List Subreddit',
    description: '列出 subreddit 内帖子（hot/new/top/rising/controversial）',
    parameters: {
      type: 'object',
      properties: {
        sub: { type: 'string', description: 'subreddit 名（不带 r/ 前缀）' },
        sort: { type: 'string', enum: ['hot', 'new', 'top', 'rising', 'controversial', 'best'], default: 'hot' },
        t: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year', 'all'], description: 'top/controversial 排序生效' },
        limit: { type: 'number', description: '默认 25, 上限 100' },
        after: { type: 'string', description: '分页游标，例如 t3_xxx' },
      },
      required: ['sub'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'subreddit',
    method: 'listSubreddit',
    execute: makeReadToolExecutor({
      toolName: 'reddit_list_subreddit',
      pageKey: 'subreddit',
      method: 'listSubreddit',
      buildTargetUrl: (p) => targets.listSubredditUrl(p),
    }),
  },
  {
    name: 'reddit_subreddit_about',
    label: 'Reddit Ops: Subreddit About',
    description: '读取 subreddit 元信息（订阅数 / 描述 / 是否 NSFW 等）',
    parameters: {
      type: 'object',
      properties: { sub: { type: 'string' } },
      required: ['sub'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'subreddit',
    method: 'subredditAbout',
    execute: makeReadToolExecutor({
      toolName: 'reddit_subreddit_about',
      pageKey: 'subreddit',
      method: 'subredditAbout',
      buildTargetUrl: (p) => targets.subredditAboutUrl(p),
    }),
  },
  {
    name: 'reddit_search',
    label: 'Reddit Ops: Search',
    description: '搜索 Reddit（posts / subreddits / users）',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '查询字符串' },
        sort: { type: 'string', enum: ['relevance', 'hot', 'top', 'new', 'comments'], default: 'relevance' },
        t: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year', 'all'], default: 'all' },
        type: { type: 'string', enum: ['link', 'sr', 'user'], default: 'link' },
        sub: { type: 'string', description: '限定到某 subreddit（同时设置 restrictSr=true）' },
        restrictSr: { type: 'boolean', description: '是否仅在 sub 内搜索' },
        limit: { type: 'number' },
        after: { type: 'string' },
      },
      required: ['q'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'search',
    method: 'search',
    execute: makeReadToolExecutor({
      toolName: 'reddit_search',
      pageKey: 'search',
      method: 'search',
      buildTargetUrl: (p) => targets.searchUrl(p),
    }),
  },
  {
    name: 'reddit_user_profile',
    label: 'Reddit Ops: User Profile',
    description: '读取 user 页（overview/submitted/comments/saved/upvoted/downvoted/hidden）',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'reddit 用户名（不带 u/ 前缀）' },
        tab: { type: 'string', enum: ['overview', 'submitted', 'comments', 'saved', 'upvoted', 'downvoted', 'hidden'], default: 'overview' },
        sort: { type: 'string', enum: ['new', 'hot', 'top', 'controversial'], default: 'new' },
        t: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year', 'all'], default: 'all' },
        limit: { type: 'number' },
        after: { type: 'string' },
      },
      required: ['name'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'user',
    method: 'userProfile',
    execute: makeReadToolExecutor({
      toolName: 'reddit_user_profile',
      pageKey: 'user',
      method: 'userProfile',
      buildTargetUrl: (p) => targets.userProfileUrl(p),
    }),
  },
  {
    name: 'reddit_inbox_list',
    label: 'Reddit Ops: Inbox List',
    description: '读取登录用户的 inbox / unread / messages / mentions / sent（必须已登录）',
    parameters: {
      type: 'object',
      properties: {
        box: { type: 'string', enum: ['inbox', 'unread', 'messages', 'mentions', 'sent'], default: 'inbox' },
        limit: { type: 'number' },
        after: { type: 'string' },
      },
      required: [],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'inbox',
    method: 'inboxList',
    execute: makeReadToolExecutor({
      toolName: 'reddit_inbox_list',
      pageKey: 'inbox',
      method: 'inboxList',
      buildTargetUrl: (p) => targets.inboxListUrl(p),
    }),
  },
  {
    name: 'reddit_my_feed',
    label: 'Reddit Ops: My Feed',
    description: '读取 home / popular / all feed（home 需登录）',
    parameters: {
      type: 'object',
      properties: {
        feed: { type: 'string', enum: ['home', 'popular', 'all'], default: 'home' },
        sort: { type: 'string', enum: ['best', 'hot', 'new', 'top', 'rising', 'controversial'], default: 'best' },
        t: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year', 'all'] },
        limit: { type: 'number' },
        after: { type: 'string' },
      },
      required: [],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'home',
    method: 'myFeed',
    execute: makeReadToolExecutor({
      toolName: 'reddit_my_feed',
      pageKey: 'home',
      method: 'myFeed',
      buildTargetUrl: (p) => targets.myFeedUrl(p),
    }),
  },
  {
    name: 'reddit_expand_more',
    label: 'Reddit Ops: Expand More Comments',
    description: '展开 reddit_get_post 评论树里的 more 节点（调 /api/morechildren）。需先用 reddit_get_post 拿到 _kind="more" 节点的 _children 列表。',
    parameters: {
      type: 'object',
      properties: {
        linkId: { type: 'string', description: '帖子 fullname，形如 t3_xxxxx（来自 reddit_get_post 顶层 source_url 或元数据）' },
        children: {
          oneOf: [
            { type: 'array', items: { type: 'string' } },
            { type: 'string', description: '逗号分隔的 child id 列表' },
          ],
          description: 'morechildren 子节点 id 列表（reddit_get_post 评论树里 _kind="more" 节点的 _children 字段）',
        },
        sort: {
          type: 'string',
          enum: ['top', 'best', 'new', 'old', 'controversial', 'qa', 'confidence'],
          default: 'top',
        },
        depth: { type: 'number', description: '可选：展开深度上限（默认走 reddit 默认值）' },
        limitChildren: { type: 'number', description: '一次提交的 child id 上限（默认 200，最大 500，超出会被截断）' },
      },
      required: ['linkId', 'children'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'post',
    method: 'expandMore',
    execute: makeReadToolExecutor({
      toolName: 'reddit_expand_more',
      pageKey: 'post',
      method: 'expandMore',
      buildTargetUrl: () => null,
    }),
  },

  // ---- INTERACTIVE 档（仅 location.assign，不模拟点击，不写任何业务数据）----
  {
    name: 'reddit_navigate_post',
    label: 'Reddit Ops: Navigate To Post',
    description: '把浏览器导航到指定帖子页（仅 location.assign）',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '帖子 URL（与 sub+postId 二选一）' },
        sub: { type: 'string' },
        postId: { type: 'string', description: '不带 t3_ 前缀' },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'post',
    method: 'navigatePost',
    execute: makeNavigateToolExecutor({ toolName: 'reddit_navigate_post', pageKey: 'post', method: 'navigatePost' }),
  },
  {
    name: 'reddit_navigate_subreddit',
    label: 'Reddit Ops: Navigate To Subreddit',
    description: '导航到 subreddit 列表页或 about 页',
    parameters: {
      type: 'object',
      properties: {
        sub: { type: 'string' },
        sort: { type: 'string', enum: ['hot', 'new', 'top', 'rising', 'controversial', 'best'] },
        t: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year', 'all'] },
        about: { type: 'boolean', default: false },
      },
      required: ['sub'],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'subreddit',
    method: 'navigateSubreddit',
    execute: makeNavigateToolExecutor({ toolName: 'reddit_navigate_subreddit', pageKey: 'subreddit', method: 'navigateSubreddit' }),
  },
  {
    name: 'reddit_navigate_search',
    label: 'Reddit Ops: Navigate To Search',
    description: '导航到搜索结果页',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        sort: { type: 'string', enum: ['relevance', 'hot', 'top', 'new', 'comments'] },
        t: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year', 'all'] },
        type: { type: 'string', enum: ['link', 'sr', 'user'] },
        sub: { type: 'string' },
        restrictSr: { type: 'boolean' },
        clear: { type: 'boolean', description: '不带 q 时把 URL 清回 /search/' },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'search',
    method: 'navigateSearch',
    execute: makeNavigateToolExecutor({ toolName: 'reddit_navigate_search', pageKey: 'search', method: 'navigateSearch' }),
  },
  {
    name: 'reddit_navigate_user',
    label: 'Reddit Ops: Navigate To User',
    description: '导航到用户主页或某个 tab',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        tab: { type: 'string', enum: ['overview', 'submitted', 'comments', 'saved', 'upvoted', 'downvoted', 'gilded', 'hidden'] },
      },
      required: ['name'],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'user',
    method: 'navigateUser',
    execute: makeNavigateToolExecutor({ toolName: 'reddit_navigate_user', pageKey: 'user', method: 'navigateUser' }),
  },
  {
    name: 'reddit_navigate_inbox',
    label: 'Reddit Ops: Navigate To Inbox',
    description: '导航到收件箱（必须已登录）',
    parameters: {
      type: 'object',
      properties: {
        box: { type: 'string', enum: ['inbox', 'unread', 'messages', 'mentions', 'sent', 'moderator'], default: 'inbox' },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'inbox',
    method: 'navigateInbox',
    execute: makeNavigateToolExecutor({ toolName: 'reddit_navigate_inbox', pageKey: 'inbox', method: 'navigateInbox' }),
  },
  {
    name: 'reddit_navigate_home',
    label: 'Reddit Ops: Navigate To Home',
    description: '导航到 home / popular / all',
    parameters: {
      type: 'object',
      properties: {
        feed: { type: 'string', enum: ['home', 'popular', 'all'], default: 'home' },
        sort: { type: 'string', enum: ['best', 'hot', 'new', 'top', 'rising'] },
        t: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year', 'all'] },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'home',
    method: 'navigateHome',
    execute: makeNavigateToolExecutor({ toolName: 'reddit_navigate_home', pageKey: 'home', method: 'navigateHome' }),
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
  name: 'JS Reddit Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    platforms: ['reddit.com'],
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
};
