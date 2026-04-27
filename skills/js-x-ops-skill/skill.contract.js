'use strict';

/**
 * js-x-ops-skill skill contract（v3.0）
 *
 * 按 reddit 模板抽工厂：
 *   - makeApiToolExecutor:      4 个老 READ 工具（搜索/profile/post/home）继续走 lib/api.js（自带 bridge-first + fallback）
 *   - makeBridgeReadExecutor:   x_session_state 走 lib/runTool.js -> bridge.sessionState（不进 cache）
 *   - makeNavigateToolExecutor: 4 个 INTERACTIVE 导航工具，仅 location.assign，不模拟点击
 *
 * 安全分级（每个 tool 都标了 interactive/destructive 两个 flag）：
 *
 * | 档        | 工具                                                                       | flag                                              |
 * |-----------|----------------------------------------------------------------------------|---------------------------------------------------|
 * | READ      | x_search_tweets / x_get_profile / x_get_post / x_get_home_feed / x_session_state | interactive=false, destructive=false              |
 * | INTERACTIVE | x_navigate_search / x_navigate_profile / x_navigate_post / x_navigate_home | interactive=true,  destructive=false              |
 * | DESTRUCTIVE | (留 v3.1：x_create_tweet / x_reply_tweet / x_quote_tweet / x_create_thread)  | -                                                 |
 *
 * 注意 x_get_post 的 schema 里仍保留 reply/post/quote/thread 等写参数（v2.0.1 行为，CLI 透传 scripts/x-post.js），
 * description 标 deprecated，等 v3.1 拆 compose-bridge 后改用专门的写工具。
 */

const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { searchTweets, getProfileTweets, getPost, getHomeFeed } = require('./lib/api');
const { runTool } = require('./lib/runTool');
const { Session } = require('./lib/session');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');
const { PAGE_PROFILES } = require('./lib/config');
const targets = require('./lib/toolTargets');

const CLI_COMMANDS = [
  { name: 'search', description: '搜索 X 平台内容（READ）' },
  { name: 'profile', description: '浏览指定用户主页与时间线（READ）' },
  { name: 'post', description: '读取帖子详情或执行发布操作（READ + 写参数透传 v2 path）' },
  { name: 'home', description: '浏览首页 Feed（READ）' },
  { name: 'session-state', description: '读取 X 登录态' },
  { name: 'doctor', description: '连通性 + 登录态 + bridge 注入 + probe + state 汇总（4 profile 一站诊断）' },
  { name: 'probe', description: '采集页面指纹（按 page profile）' },
  { name: 'state', description: '读取当前 page profile 状态' },
  { name: 'navigate-search', description: '导航到 X 搜索页（INTERACTIVE）' },
  { name: 'navigate-profile', description: '导航到 X 用户主页（INTERACTIVE）' },
  { name: 'navigate-post', description: '导航到 X 推文详情（INTERACTIVE）' },
  { name: 'navigate-home', description: '导航到 X 首页（INTERACTIVE）' },
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
  const resolvedConfig = resolveRuntimeConfig(config);
  const runtimeConfig = {
    serverUrl: resolvedConfig.serverUrl,
    recording: resolvedConfig.recording,
    requestTimeout: Number(config.requestTimeout || 1800),
    defaultMaxPages: Number(config.defaultMaxPages || 3),
    pages: Object.keys(PAGE_PROFILES),
  };

  let bot = null;

  return {
    config: runtimeConfig,
    logger: resolvedLogger,
    ensureBot() {
      if (!bot) {
        bot = new BrowserAutomation(runtimeConfig.serverUrl, {
          defaultTimeout: runtimeConfig.requestTimeout,
          logger: resolvedLogger,
        });
      }
      return bot;
    },
    textResult(text) { return { content: [{ type: 'text', text }] }; },
    jsonResult(value) { return this.textResult(JSON.stringify(value, null, 2)); },
    dispose() {
      if (bot && typeof bot.disconnect === 'function') {
        try { bot.disconnect(); } catch { /* ignore */ }
      }
      bot = null;
    },
  };
}

// ---------------------------------------------------------------------------
// 工厂 1：API 直连（4 个主 READ 工具走 lib/api.js，享受 bridge-first + fallback）
// ---------------------------------------------------------------------------

function makeApiToolExecutor({ apiFn, paramsToOptions, paramsToInputs }) {
  return async function execute(runtime, params, context = {}) {
    const opts = Object.assign(
      {
        logger: runtime.logger,
        recording: runtime.config.recording,
        runId: context.toolCallId,
      },
      paramsToOptions ? paramsToOptions(params || {}, runtime.config) : {},
    );
    const inputs = paramsToInputs ? paramsToInputs(params || {}) : [];
    return apiFn(runtime.ensureBot(), ...inputs, opts);
  };
}

// ---------------------------------------------------------------------------
// 工厂 2：bridge 直连（READ 不可枚举的轻量工具，例如 x_session_state）
//   走 lib/runTool.js → Session.callApi(bridge.method)，不进 cache，仅 history。
// ---------------------------------------------------------------------------

function makeBridgeReadExecutor({ pageKey, method, toolName, buildTargetUrl }) {
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
        reuseAnyXTab: true,
        createUrl: targetUrl || 'https://x.com/',
      },
    });
  };
}

// ---------------------------------------------------------------------------
// 工厂 3：INTERACTIVE 导航（仅 location.assign，不模拟点击；跨域被 bridge 拒绝）
// ---------------------------------------------------------------------------

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
        reuseAnyXTab: true,
        createUrl: 'https://x.com/',
      },
    });
    try {
      await session.connect();
      await session.resolveTarget();
      await session.ensureBridge();
      const navResp = await session.callApi(method, [params || {}]);
      if (!navResp || !navResp.ok) {
        return {
          platform: 'x',
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
        platform: 'x',
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

// ---------------------------------------------------------------------------
// TOOL_DEFINITIONS（声明式）
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  // ---------- READ：4 个主工具走 lib/api.js（bridge-first + fallback） ----------
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
    interactive: false,
    destructive: false,
    pageKey: 'search',
    method: 'search',
    execute: makeApiToolExecutor({
      apiFn: searchTweets,
      paramsToInputs: (p) => [p.keyword],
      paramsToOptions: (p, runtimeConfig) => ({
        maxPages: p.maxPages || runtimeConfig.defaultMaxPages,
        sort: p.sort || 'top',
        lang: p.lang,
        from: p.from,
        since: p.since,
        until: p.until,
        minLikes: p.minLikes || 0,
        minRetweets: p.minRetweets || 0,
        excludeReplies: p.excludeReplies || false,
        excludeRetweets: p.excludeRetweets || false,
      }),
    }),
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
    interactive: false,
    destructive: false,
    pageKey: 'profile',
    method: 'getProfile',
    execute: makeApiToolExecutor({
      apiFn: getProfileTweets,
      paramsToInputs: (p) => [p.username],
      paramsToOptions: (p, runtimeConfig) => ({
        maxPages: p.maxPages || runtimeConfig.defaultMaxPages,
        maxTweets: p.maxTweets || 0,
        since: p.since,
        until: p.until,
        includeReplies: p.includeReplies || false,
        includeRetweets: p.includeRetweets || false,
        minLikes: p.minLikes || 0,
      }),
    }),
  },
  {
    name: 'x_get_post',
    label: 'X Ops: Get Post Detail',
    description: '读取 X.com 帖子的完整详情，包括内容、统计、媒体。可选获取对话线程和回复。**deprecated 写参数**（reply/post/quote/thread/media）会透传到 v2 scripts/x-post.js，将在 v3.1 移到独立工具：x_create_tweet / x_reply_tweet / x_quote_tweet / x_create_thread。',
    parameters: {
      type: 'object',
      properties: {
        tweetUrl: {
          type: 'string',
          description: '推文 URL 或 ID（如 https://x.com/user/status/123 或纯数字 ID）。多条用逗号分隔。',
        },
        withThread: { type: 'boolean', description: '是否获取对话线程（上文）' },
        withReplies: { type: 'number', description: '获取回复数量（0 = 不获取）' },
        reply: { type: 'string', description: '【deprecated, v3.1 移到 x_reply_tweet】回复文本，需配合 tweetUrl' },
        post: { type: 'string', description: '【deprecated, v3.1 移到 x_create_tweet】发新帖正文（与 tweetUrl 互斥）' },
        quote: { type: 'string', description: '【deprecated, v3.1 移到 x_quote_tweet】引用推文，需配合 post 提供评论文本' },
        thread: { type: 'array', items: { type: 'string' }, description: '【deprecated, v3.1 移到 x_create_thread】串推数组' },
        dryRun: { type: 'boolean', description: '【deprecated】仅校验输入，不实际发布' },
        confirm: { type: 'boolean', description: '【deprecated】写操作必须显式 confirm=true 才会真发' },
      },
      required: ['tweetUrl'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'post',
    method: 'getPost',
    execute: makeApiToolExecutor({
      apiFn: getPost,
      paramsToInputs: (p) => {
        const inputs = String(p.tweetUrl || '').split(',').map((item) => item.trim()).filter(Boolean);
        return [inputs];
      },
      paramsToOptions: (p) => ({
        withThread: p.withThread || false,
        withReplies: p.withReplies || 0,
        reply: p.reply,
        post: p.post,
        quote: p.quote,
        thread: p.thread,
        dryRun: p.dryRun,
        confirm: p.confirm,
      }),
    }),
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
    interactive: false,
    destructive: false,
    pageKey: 'home',
    method: 'getHome',
    execute: makeApiToolExecutor({
      apiFn: getHomeFeed,
      paramsToInputs: () => [],
      paramsToOptions: (p, runtimeConfig) => ({
        feed: p.feed || 'foryou',
        maxPages: p.maxPages || runtimeConfig.defaultMaxPages,
        maxTweets: p.maxTweets || 0,
        minLikes: p.minLikes || 0,
        excludeReplies: p.excludeReplies || false,
        excludeRetweets: p.excludeRetweets || false,
      }),
    }),
  },

  // ---------- READ：x_session_state（轻量，不进 cache，走 bridge.sessionState） ----------
  {
    name: 'x_session_state',
    label: 'X Ops: Session State',
    description: '读取当前浏览器中 X.com 的登录态（home-bridge.sessionState）；未登录回 {loggedIn:false}。',
    parameters: { type: 'object', properties: {}, required: [] },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'home',
    method: 'sessionState',
    execute: makeBridgeReadExecutor({
      toolName: 'x_session_state',
      pageKey: 'home',
      method: 'sessionState',
      buildTargetUrl: () => null,
    }),
  },

  // ---------- INTERACTIVE：4 个 navigate 工具（仅 location.assign） ----------
  {
    name: 'x_navigate_search',
    label: 'X Ops: Navigate To Search',
    description: '把浏览器导航到 X 搜索结果页（仅 location.assign）。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词（不传则只切到 /search）' },
        sort: { type: 'string', enum: ['top', 'latest', 'media'], description: '排序方式' },
        lang: { type: 'string', description: '搜索语言代码' },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'search',
    method: 'navigateSearch',
    execute: makeNavigateToolExecutor({ toolName: 'x_navigate_search', pageKey: 'search', method: 'navigateSearch' }),
  },
  {
    name: 'x_navigate_profile',
    label: 'X Ops: Navigate To Profile',
    description: '把浏览器导航到指定用户主页（仅 location.assign）。',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: '用户名（不带 @）' },
        tab: { type: 'string', enum: ['tweets', 'with_replies', 'media', 'likes', 'highlights'], description: '用户子页 tab' },
      },
      required: ['username'],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'profile',
    method: 'navigateProfile',
    execute: makeNavigateToolExecutor({ toolName: 'x_navigate_profile', pageKey: 'profile', method: 'navigateProfile' }),
  },
  {
    name: 'x_navigate_post',
    label: 'X Ops: Navigate To Post',
    description: '把浏览器导航到推文详情页（仅 location.assign）。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '推文 URL（与 tweetId 二选一）' },
        tweetId: { type: 'string', description: '推文 ID（纯数字）' },
        username: { type: 'string', description: '可选：作者用户名（与 tweetId 配合使用）' },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'post',
    method: 'navigatePost',
    execute: makeNavigateToolExecutor({ toolName: 'x_navigate_post', pageKey: 'post', method: 'navigatePost' }),
  },
  {
    name: 'x_navigate_home',
    label: 'X Ops: Navigate To Home',
    description: '把浏览器导航到 X 首页（仅 location.assign，不切 For You/Following Tab；切 Tab 由 UI 完成）。',
    parameters: {
      type: 'object',
      properties: {
        feed: { type: 'string', enum: ['foryou', 'following'], description: 'Feed 类型（信息性，URL 上无差异）' },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'home',
    method: 'navigateHome',
    execute: makeNavigateToolExecutor({ toolName: 'x_navigate_home', pageKey: 'home', method: 'navigateHome' }),
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
  name: 'JS X Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    requiresLogin: true,
    platforms: ['x.com', 'twitter.com'],
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
  // 工厂导出供测试 / 业务脚本复用
  makeApiToolExecutor,
  makeBridgeReadExecutor,
  makeNavigateToolExecutor,
};
