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
const { runMonitor } = require('./lib/runMonitor');
const { Session } = require('./lib/session');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');
const { PAGE_PROFILES } = require('./lib/config');
const targets = require('./lib/toolTargets');
const monitorConfig = require('./lib/monitor/config');
const monitorState = require('./lib/monitor/state');
const monitorPaths = require('./lib/monitor/paths');
const { fetchAccount } = require('./lib/monitor/fetchAccount');

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
// 工厂 3a：Monitor 工具（对 AI 只暴露 5 个受控操作，不会对外发通知）
//   - 读配置 / 读状态：list_accounts / get_status
//   - 写本地 config：add_account / remove_account（显式在 description 注明）
//   - 读 X：test_account（调 fetchAccount，不写 state、不发通知）
//   全部走 lib/runMonitor.js，history + debug bundle。
// ---------------------------------------------------------------------------

function makeMonitorToolExecutor({ toolName, handler }) {
  return async function execute(runtime, params, context = {}) {
    return runMonitor({
      toolName,
      input: params || {},
      options: {
        recording: runtime.config.recording,
        runId: context.toolCallId,
      },
      handler: async (ctx) => handler({ runtime, params: params || {}, context, ...ctx }),
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
    description: '读取当前浏览器中 X.com 的登录态 + whoami（home-bridge.sessionState）；已登录返回 {loggedIn, username, screenName, userId?, displayName?, name(=screen_name)}；未登录回 {loggedIn:false}。',
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
        feed: { type: 'string', enum: ['foryou', 'following'], description: 'Feed 类型（信息性,URL 上无差异）' },
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

  // ---------- Monitor：5 个受控工具（不暴露 init/check/daemon/stop，后三项会触发外部副作用,仅 CLI） ----------
  {
    name: 'x_monitor_list_accounts',
    label: 'X Ops Monitor: List Accounts',
    description: '列出当前 monitor 配置中的所有监控账号（读本地 config.json，不访问 X，不产生任何外部副作用）。',
    parameters: { type: 'object', properties: {}, required: [] },
    optional: true,
    interactive: false,
    destructive: false,
    execute: makeMonitorToolExecutor({
      toolName: 'x_monitor_list_accounts',
      handler: async () => {
        if (!monitorConfig.exists()) {
          return { ok: false, error: { code: 'E_MONITOR_NOT_INITIALIZED', message: 'monitor 未初始化，请先在 CLI 运行 `node index.js monitor init`' } };
        }
        const config = monitorConfig.loadConfig();
        const accounts = (config.accounts || []).map((a) => monitorConfig.effectiveAccountSettings(a, config));
        return {
          ok: true,
          configFile: monitorPaths.resolvePaths().configFile,
          accountsCount: accounts.length,
          accounts,
          channels: (config.channels || []).map((c) => ({ name: c.name, type: c.type })),
          scheduling: config.scheduling || null,
          deduplication: config.deduplication || null,
        };
      },
    }),
  },
  {
    name: 'x_monitor_get_status',
    label: 'X Ops Monitor: Get Status',
    description: '汇总当前 monitor 的运行状态：每个账号的 lastCheck / knownTweetCount / lastError，以及 daemon 进程存活态（读本地 state + pid，不访问 X，不产生副作用）。',
    parameters: { type: 'object', properties: {}, required: [] },
    optional: true,
    interactive: false,
    destructive: false,
    execute: makeMonitorToolExecutor({
      toolName: 'x_monitor_get_status',
      handler: async () => {
        if (!monitorConfig.exists()) {
          return { ok: false, error: { code: 'E_MONITOR_NOT_INITIALIZED', message: 'monitor 未初始化' } };
        }
        const config = monitorConfig.loadConfig();
        const { pidFile, configFile } = monitorPaths.resolvePaths();
        let daemon = { pidFile, pid: null, alive: false };
        try {
          const fs = require('fs');
          const raw = fs.readFileSync(pidFile, 'utf8').trim();
          const pid = parseInt(raw, 10);
          if (pid > 0) {
            let alive = false;
            try { process.kill(pid, 0); alive = true; } catch {}
            daemon = { pidFile, pid, alive };
          }
        } catch { /* no pid file */ }
        const accountsSummary = (config.accounts || []).map((a) => {
          const st = (() => { try { return monitorState.loadState(a.username); } catch { return null; } })();
          return {
            username: a.username,
            enabled: a.enabled !== false,
            lastCheck: st?.lastCheck || null,
            lastError: st?.lastError || null,
            knownTweetCount: Array.isArray(st?.tweets) ? st.tweets.length : 0,
          };
        });
        return {
          ok: true,
          configFile,
          accountsCount: accountsSummary.length,
          accounts: accountsSummary,
          daemon,
        };
      },
    }),
  },
  {
    name: 'x_monitor_add_account',
    label: 'X Ops Monitor: Add Account',
    description: '把一个 X 账号加入监控列表。**本工具会写本地配置文件 ~/.js-eyes/skill-data/js-x-ops-skill/monitor/config.json**；不会访问 X，不会对外发通知。若账号已存在则更新其 channels/enabled。',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'X 用户名（不带 @）' },
        channels: { type: 'array', items: { type: 'string' }, description: '账号级通知 channel 名单（引用 config.channels[].name），为空则继承全局' },
      },
      required: ['username'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    execute: makeMonitorToolExecutor({
      toolName: 'x_monitor_add_account',
      handler: async ({ params }) => {
        if (!monitorConfig.exists()) {
          return { ok: false, error: { code: 'E_MONITOR_NOT_INITIALIZED', message: 'monitor 未初始化' } };
        }
        const clean = String(params.username || '').replace(/^@/, '').trim();
        if (!clean) return { ok: false, error: { code: 'E_BAD_ARG', message: 'username 必填' } };
        const config = monitorConfig.loadConfig();
        const existing = (config.accounts || []).find((a) => String(a.username).toLowerCase() === clean.toLowerCase());
        if (existing) {
          if (Array.isArray(params.channels)) existing.channels = params.channels;
          existing.enabled = true;
          monitorConfig.saveConfig(config);
          return { ok: true, added: false, updated: true, account: existing, accountsCount: config.accounts.length };
        }
        const record = { username: clean, enabled: true, addedAt: new Date().toISOString() };
        if (Array.isArray(params.channels)) record.channels = params.channels;
        config.accounts.push(record);
        monitorConfig.saveConfig(config);
        return { ok: true, added: true, updated: false, account: record, accountsCount: config.accounts.length };
      },
    }),
  },
  {
    name: 'x_monitor_remove_account',
    label: 'X Ops Monitor: Remove Account',
    description: '从监控列表移除一个 X 账号。**本工具会写本地配置文件**；不会访问 X，不会清除已有 state 文件（保留历史用于调试）。',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'X 用户名（不带 @）' },
      },
      required: ['username'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    execute: makeMonitorToolExecutor({
      toolName: 'x_monitor_remove_account',
      handler: async ({ params }) => {
        if (!monitorConfig.exists()) {
          return { ok: false, error: { code: 'E_MONITOR_NOT_INITIALIZED', message: 'monitor 未初始化' } };
        }
        const clean = String(params.username || '').replace(/^@/, '').trim();
        if (!clean) return { ok: false, error: { code: 'E_BAD_ARG', message: 'username 必填' } };
        const config = monitorConfig.loadConfig();
        const before = config.accounts.length;
        config.accounts = (config.accounts || []).filter((a) => String(a.username).toLowerCase() !== clean.toLowerCase());
        const removed = before - config.accounts.length;
        monitorConfig.saveConfig(config);
        return { ok: true, removed, accountsCount: config.accounts.length };
      },
    }),
  },
  {
    name: 'x_monitor_test_account',
    label: 'X Ops Monitor: Test Account',
    description: '对单个账号跑一次时间线抓取用于配置调试。**对 X 是 READ，不写 state、不发任何通知**；复用 monitor 全局 defaults 或账号级覆盖。返回 sampleSize + 前 3 条预览。',
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'X 用户名（不带 @）' },
        maxPages: { type: 'number', description: '翻页数（默认 1）' },
        includeReplies: { type: 'boolean' },
        includeRetweets: { type: 'boolean' },
      },
      required: ['username'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    execute: makeMonitorToolExecutor({
      toolName: 'x_monitor_test_account',
      handler: async ({ runtime, params }) => {
        const clean = String(params.username || '').replace(/^@/, '').trim();
        if (!clean) return { ok: false, error: { code: 'E_BAD_ARG', message: 'username 必填' } };
        let config = null;
        try { config = monitorConfig.loadConfig(); } catch { /* ok, 用 defaults */ }
        const baseAccount = (config && (config.accounts || []).find((a) => String(a.username).toLowerCase() === clean.toLowerCase())) || { username: clean, enabled: true };
        const effectiveBase = config ? monitorConfig.effectiveAccountSettings(baseAccount, config) : {
          username: clean, enabled: true,
          includeRetweets: false, includeReplies: false,
          summaryLength: 100, maxPagesPerCheck: params.maxPages || 1, minLikes: 0,
          channelNames: [],
        };
        const settings = Object.assign({}, effectiveBase, {
          maxPagesPerCheck: params.maxPages || effectiveBase.maxPagesPerCheck,
          includeReplies: params.includeReplies != null ? !!params.includeReplies : effectiveBase.includeReplies,
          includeRetweets: params.includeRetweets != null ? !!params.includeRetweets : effectiveBase.includeRetweets,
        });
        const result = await fetchAccount(runtime.ensureBot(), settings, { recording: runtime.config.recording });
        return {
          ok: result.ok,
          username: settings.username,
          sampleSize: result.tweets.length,
          rawCount: result.rawCount,
          meta: result.meta,
          profile: result.profile ? { screenName: result.profile.screenName, name: result.profile.name } : null,
          tweets: result.tweets.slice(0, 3).map((t) => ({
            tweetId: t.tweetId,
            publishTime: t.publishTime,
            content: String(t.content || '').slice(0, 120),
          })),
          error: result.error || null,
        };
      },
    }),
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
  makeMonitorToolExecutor,
};
