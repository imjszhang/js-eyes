'use strict';

/**
 * js-x-ops-skill skill contract（v3.0）
 *
 * 按 reddit 模板抽工厂：
 *   - makeBridgeReadExecutor: x_session_state
 *   - makeReadToolExecutor: 4 主 READ → lib/runTool.js（api_* / dom_* + 审计字段）
 *   - makeNavigateToolExecutor: 4 个 INTERACTIVE 导航工具，仅 location.assign，不模拟点击
 *
 * 安全分级（每个 tool 都标了 interactive/destructive 两个 flag）：
 *
 * | 档        | 工具                                                                       | flag                                              |
 * |-----------|----------------------------------------------------------------------------|---------------------------------------------------|
 * | READ      | x_search_tweets / x_search_archive / x_get_profile / x_get_post / x_get_home_feed / x_session_state | interactive=false, destructive=false              |
 * | INTERACTIVE | x_navigate_search / x_navigate_profile / x_navigate_post / x_navigate_home | interactive=true,  destructive=false              |
 * | DESTRUCTIVE | x_create_article / x_publish_article / (留 v3.1：x_create_tweet / x_reply_tweet / x_quote_tweet / x_create_thread)  | destructive=true                                  |
 *
 * 注意 x_get_post 的 schema 里仍保留 reply/post/quote/thread 等写参数（v2.0.1 行为，CLI 透传 scripts/x-post.js），
 * description 标 deprecated，等 v3.1 拆 compose-bridge 后改用专门的写工具。
 */

const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const {
  classifyXPostInput,
  buildPostBridgeArgs,
  canonicalNavigateUrl,
} = require('./lib/xUrl');
const { getPost } = require('./lib/api');
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
const { createOfficialApiClient, buildSearchQueryOptions, normalizeSearchResults } = require('./lib/official-api');

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
// 工厂 1：API 直连（保留给 x_get_post 多 ID / 写参数透传 v2 path）
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

function omitReadMode(raw) {
  const p = Object.assign({}, raw || {});
  delete p.readMode;
  return p;
}

function buildContractSearchTargetUrl(params) {
  const p = params || {};
  const keyword = String(p.keyword || '').trim();
  if (!keyword) return null;
  const u = new URL('https://x.com/search');
  u.searchParams.set('q', keyword);
  u.searchParams.set('src', 'typed_query');
  const sortRaw = String(p.sort || 'top').toLowerCase();
  if (sortRaw === 'latest') u.searchParams.set('f', 'live');
  else if (sortRaw === 'media') u.searchParams.set('f', 'image');
  return u.toString();
}

function buildContractProfileTargetUrl(p) {
  const u = String((p && p.username) || '').replace(/^@/, '').trim();
  if (!u) return null;
  let path = 'https://x.com/' + encodeURIComponent(u);
  if (p && p.includeReplies) path += '/with_replies';
  return path;
}

function buildContractPostTargetUrl(p) {
  const raw = (p && p.tweetUrl) ? String(p.tweetUrl).split(',')[0].trim() : '';
  if (!raw) return null;
  if (/^\d{6,}$/.test(raw)) return null;
  try {
    const u = new URL(raw.includes('http') ? raw : 'https://' + raw);
    if (/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(u.hostname)) return u.href;
    if (/(^|\.)t\.co$/i.test(u.hostname)) return u.href;
  } catch (_) {}
  const cls = classifyXPostInput(raw);
  return canonicalNavigateUrl(cls, raw);
}

function enrichRunToolResult(toolKey, rt) {
  if (!rt || !rt.ok) {
    return {
      ok: false,
      error: (rt && rt.error) || { code: 'unknown', message: 'runTool failed' },
      runToolAudit: rt ? {
        triedMethods: rt.triedMethods,
        usedMethod: rt.usedMethod,
        readMode: rt.readMode,
        fallback: rt.fallback,
        requestedReadMode: rt.requestedReadMode,
      } : null,
    };
  }
  const data = rt.result || {};
  const envelope = {
    runToolAudit: {
      readMode: rt.readMode,
      requestedReadMode: rt.requestedReadMode,
      fallback: rt.fallback,
      triedMethods: rt.triedMethods,
      usedMethod: rt.usedMethod,
    },
  };
  if (toolKey === 'x_search_tweets') {
    return Object.assign({ ok: true }, data, envelope);
  }
  if (toolKey === 'x_get_profile') {
    return Object.assign({ ok: true }, data, envelope);
  }
  if (toolKey === 'x_get_home_feed') {
    return Object.assign({ ok: true }, data, envelope);
  }
  if (toolKey === 'x_get_post') {
    return Object.assign({ ok: true }, data, envelope);
  }
  if (toolKey === 'x_session_state') {
    return Object.assign({ ok: true }, data, envelope);
  }
  return Object.assign({ ok: true }, data, envelope);
}

function makeReadToolExecutor({ toolName, toolKey, pageKey, method, cmdDef, buildTargetUrl }) {
  return async function execute(runtime, params, context = {}) {
    const p = params || {};
    const targetUrl = typeof buildTargetUrl === 'function' ? buildTargetUrl(p) : null;
    let args = omitReadMode(p);
    if ((method === 'search' || method === 'getProfile' || method === 'getHome')
      && (args.maxPages == null || args.maxPages === undefined)
      && runtime.config.defaultMaxPages != null) {
      args = Object.assign({}, args, { maxPages: runtime.config.defaultMaxPages });
    }
    let rt = await runTool(runtime.ensureBot(), {
      toolName,
      pageKey,
      method,
      cmdDef,
      args,
      targetUrl,
      options: {
        wsEndpoint: runtime.config.serverUrl,
        recording: runtime.config.recording,
        runId: context.toolCallId,
        navigateOnReuse: false,
        reuseAnyXTab: true,
        createUrl: targetUrl || 'https://x.com/',
        timeoutMs: (runtime.config.requestTimeout || 90) * 1000,
        readMode: p.readMode,
      },
    });
    if (rt.ok && rt.result && typeof rt.result === 'object') {
      const mt = Number(args.maxTweets);
      if (toolKey === 'x_get_profile' && mt > 0 && Array.isArray(rt.result.tweets)) {
        const sliced = rt.result.tweets.slice(0, mt);
        rt = Object.assign({}, rt, {
          result: Object.assign({}, rt.result, {
            tweets: sliced,
            total: sliced.length,
          }),
        });
      }
      if (toolKey === 'x_get_home_feed' && mt > 0 && Array.isArray(rt.result.tweets)) {
        const sliced = rt.result.tweets.slice(0, mt);
        rt = Object.assign({}, rt, {
          result: Object.assign({}, rt.result, {
            tweets: sliced,
            total: sliced.length,
          }),
        });
      }
    }
    return enrichRunToolResult(toolKey, rt);
  };
}

function makeXGetPostReadOrLegacyExecutor() {
  const legacy = makeApiToolExecutor({
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
  });
  return async function execute(runtime, params, context = {}) {
    const p = params || {};
    if (p.reply || p.post || p.quote || (Array.isArray(p.thread) && p.thread.length)) {
      return legacy(runtime, params, context);
    }
    const ids = String(p.tweetUrl || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (ids.length !== 1) {
      return legacy(runtime, params, context);
    }
    const one = ids[0];
    const cls = classifyXPostInput(one);
    const targetUrl = buildContractPostTargetUrl({ tweetUrl: one });
    const bridgeArgs = buildPostBridgeArgs(cls, {
      withThread: !!p.withThread,
      withReplies: p.withReplies || 0,
      budgetMs: p.budgetMs,
    });
    const rt = await runTool(runtime.ensureBot(), {
      toolName: 'x_get_post',
      pageKey: 'post',
      method: 'getPost',
      cmdDef: {
        methodBase: 'getPost',
        domSupported: true,
        apiSupported: true,
        defaultReadMode: 'auto',
      },
      args: bridgeArgs,
      targetUrl,
      options: {
        wsEndpoint: runtime.config.serverUrl,
        recording: runtime.config.recording,
        runId: context.toolCallId,
        navigateOnReuse: false,
        reuseAnyXTab: true,
        createUrl: targetUrl || 'https://x.com/',
        timeoutMs: (runtime.config.requestTimeout || 90) * 1000,
        readMode: p.readMode,
      },
    });
    return enrichRunToolResult('x_get_post', rt);
  };
}

// ---------------------------------------------------------------------------
// 工厂 2：bridge 直连（x_session_state）
// ---------------------------------------------------------------------------

function makeBridgeReadExecutor({ pageKey, method, toolName, buildTargetUrl }) {
  return async function execute(runtime, params, context = {}) {
    const targetUrl = typeof buildTargetUrl === 'function' ? buildTargetUrl(params || {}) : null;
    const rt = await runTool(runtime.ensureBot(), {
      toolName,
      pageKey,
      method,
      cmdDef: { legacyOnly: true },
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
    return enrichRunToolResult('x_session_state', rt);
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
        readMode: {
          type: 'string',
          enum: ['auto', 'graphql', 'dom'],
          description: 'READ 数据路径：auto=GraphQL 优先失败再 DOM；graphql=仅 GraphQL；dom=仅 DOM。v3.2 由 mode 重命名而来，与 visual-* 解耦。',
        },
      },
      required: ['keyword'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'search',
    method: 'search',
    execute: makeReadToolExecutor({
      toolName: 'x_search_tweets',
      toolKey: 'x_search_tweets',
      pageKey: 'search',
      method: 'search',
      cmdDef: {
        methodBase: 'search',
        domSupported: true,
        apiSupported: true,
        defaultReadMode: 'auto',
      },
      buildTargetUrl: buildContractSearchTargetUrl,
    }),
  },
  {
    name: 'x_search_archive',
    label: 'X Ops: Search Archive (Official API)',
    description: '通过 X Official API 搜索推文（全库 search/all 或近期 search/recent）。需要 X_BEARER_TOKEN，可能产生 API 费用。与 x_search_tweets（浏览器 GraphQL 搜索）不同，无需 js-eyes 浏览器连接。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        scope: {
          type: 'string',
          enum: ['all', 'recent'],
          description: '搜索范围：all=全库（2006 至今），recent=近期（7 天）',
        },
        maxPages: { type: 'number', description: '最多翻页数' },
        maxResults: { type: 'number', description: '每页最大结果数（10-500）' },
        startTime: { type: 'string', description: '起始时间 ISO8601（如 2020-01-01T00:00:00Z）' },
        endTime: { type: 'string', description: '截止时间 ISO8601' },
        sortOrder: {
          type: 'string',
          enum: ['recency', 'relevancy'],
          description: '全库搜索排序（scope=all 时有效）',
        },
        from: { type: 'string', description: '指定作者用户名（不带 @）' },
        to: { type: 'string', description: '发给某用户的推文' },
        since: { type: 'string', description: '起始日期 YYYY-MM-DD' },
        until: { type: 'string', description: '截止日期 YYYY-MM-DD' },
        lang: { type: 'string', description: '搜索语言代码（如 zh、en）' },
        minLikes: { type: 'number', description: '最低点赞数过滤' },
        minRetweets: { type: 'number', description: '最低转发数过滤' },
        minReplies: { type: 'number', description: '最低回复数过滤' },
        excludeReplies: { type: 'boolean', description: '排除回复' },
        excludeRetweets: { type: 'boolean', description: '排除转推' },
        hasLinks: { type: 'boolean', description: '仅含链接的推文' },
        normalize: { type: 'boolean', description: '是否归一化为 bridge 兼容结构（默认 true）' },
      },
      required: ['keyword'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    execute: async function searchArchiveTool(runtime, params) {
      const p = params || {};
      const scope = String(p.scope || 'all').toLowerCase() === 'recent' ? 'recent' : 'all';
      const built = buildSearchQueryOptions({
        keyword: p.keyword,
        from: p.from,
        to: p.to,
        since: p.since,
        until: p.until,
        lang: p.lang,
        minLikes: p.minLikes,
        minRetweets: p.minRetweets,
        minReplies: p.minReplies,
        excludeReplies: p.excludeReplies,
        excludeRetweets: p.excludeRetweets,
        hasLinks: p.hasLinks,
        startTime: p.startTime,
        endTime: p.endTime,
        nextToken: p.nextToken,
        sortOrder: p.sortOrder,
        maxResults: p.maxResults,
        maxPages: p.maxPages,
        scope,
      });

      const client = createOfficialApiClient({ logger: runtime?.logger || null });
      const searchOpts = {
        startTime: built.startTime,
        endTime: built.endTime,
        maxResults: built.maxResults,
        maxPages: built.maxPages,
        nextToken: built.nextToken,
        sortOrder: built.sortOrder,
      };

      const raw = scope === 'recent'
        ? await client.searchRecent(built.fullQuery, searchOpts)
        : await client.searchAll(built.fullQuery, searchOpts);

      if (!raw.ok) {
        const message = raw.errorCode === 'forbidden'
          ? `${raw.error || 'forbidden'}（全库搜索通常需要 Pay-per-use Bearer 权限）`
          : (raw.error || 'search failed');
        return {
          ok: false,
          keyword: p.keyword,
          fullQuery: built.fullQuery,
          scope,
          tweets: [],
          count: 0,
          error: message,
          errorCode: raw.errorCode || 'search_failed',
          status_code: raw.status_code || 0,
          detail: raw.detail || '',
          via: 'official_api',
          endpoint: raw.endpoint,
        };
      }

      const normalize = p.normalize !== false;
      const tweets = normalize
        ? normalizeSearchResults(raw).tweets
        : raw.tweets;

      return {
        ok: true,
        keyword: p.keyword,
        fullQuery: built.fullQuery,
        scope,
        tweets,
        count: tweets.length,
        meta: raw.meta,
        via: 'official_api',
        endpoint: raw.endpoint,
      };
    },
  },
  {
    name: 'x_create_article',
    label: 'X Ops: Create Article (Official API)',
    description: '通过 X Official API 创建 Article 草稿（Markdown→DraftJS）。需要 OAuth 1.0a 写凭证；publish=true 时可能需 X Premium 并产生公开长文。无需 js-eyes 浏览器。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Article 标题' },
        bodyMarkdown: { type: 'string', description: 'Markdown 正文' },
        bodyFile: { type: 'string', description: 'Markdown 文件路径（与 bodyMarkdown 二选一）' },
        coverImage: { type: 'string', description: '封面图本地路径' },
        fetchRemoteImages: { type: 'boolean', description: '是否下载并上传 https 内嵌图（默认 false）' },
        publish: { type: 'boolean', description: '创建后是否立即发布（默认 false，draft-first）' },
        confirm: { type: 'boolean', description: 'publish=true 时必须 confirm=true 才会发布' },
      },
      required: ['title'],
    },
    optional: true,
    interactive: false,
    destructive: true,
    execute: async function createArticleTool(runtime, params) {
      const p = params || {};
      const title = String(p.title || '').trim();
      if (!title) {
        return { ok: false, error: 'title is required', errorCode: 'bad_arg' };
      }

      let markdown = String(p.bodyMarkdown || '');
      if (p.bodyFile) {
        const fs = require('fs');
        const path = require('path');
        markdown = fs.readFileSync(path.resolve(p.bodyFile), 'utf8');
      }
      if (!markdown.trim()) {
        return { ok: false, error: 'bodyMarkdown or bodyFile is required', errorCode: 'bad_arg' };
      }

      const client = createOfficialApiClient({ logger: runtime?.logger || null });
      const baseDir = p.bodyFile ? require('path').dirname(require('path').resolve(p.bodyFile)) : process.cwd();
      const draftResult = await client.createArticleFromMarkdown({
        title,
        markdown,
        coverPath: p.coverImage,
        fetchRemoteImages: !!p.fetchRemoteImages,
        baseDir,
      });

      if (!draftResult.success) {
        return {
          ok: false,
          error: draftResult.error || 'create article draft failed',
          errorCode: draftResult.errorCode || 'article_draft_failed',
          errors: draftResult.errors,
        };
      }

      const out = {
        ok: true,
        title: draftResult.title,
        article_id: draftResult.article_id,
        published: false,
        via: 'official_api',
      };

      if (!p.publish) return out;
      if (p.confirm !== true) {
        return {
          ok: false,
          error: 'publish requires confirm=true',
          errorCode: 'confirm_required',
          article_id: draftResult.article_id,
        };
      }

      const pub = await client.publishArticle(draftResult.article_id);
      if (!pub.success) {
        return {
          ok: false,
          error: pub.error || 'publish article failed',
          errorCode: pub.errorCode || 'article_publish_failed',
          article_id: draftResult.article_id,
          status_code: pub.status_code || 0,
          detail: pub.detail || '',
        };
      }

      return {
        ok: true,
        title: draftResult.title,
        article_id: draftResult.article_id,
        published: true,
        post_id: pub.post_id,
        article_url: pub.article_url,
        post_url: pub.post_url,
        via: 'official_api',
      };
    },
  },
  {
    name: 'x_publish_article',
    label: 'X Ops: Publish Article (Official API)',
    description: '发布已有 X Article 草稿为公开长文。需要 OAuth 1.0a 写凭证，可能需 X Premium。destructive：会产生公开可见内容。',
    parameters: {
      type: 'object',
      properties: {
        articleId: { type: 'string', description: 'Article 草稿 ID' },
        confirm: { type: 'boolean', description: '必须为 true 才会发布' },
      },
      required: ['articleId'],
    },
    optional: true,
    interactive: false,
    destructive: true,
    execute: async function publishArticleTool(runtime, params) {
      const p = params || {};
      if (p.confirm !== true) {
        return { ok: false, error: 'confirm=true is required', errorCode: 'confirm_required' };
      }
      const articleId = String(p.articleId || '').trim();
      if (!articleId) {
        return { ok: false, error: 'articleId is required', errorCode: 'bad_arg' };
      }

      const client = createOfficialApiClient({ logger: runtime?.logger || null });
      const pub = await client.publishArticle(articleId);
      if (!pub.success) {
        return {
          ok: false,
          error: pub.error || 'publish article failed',
          errorCode: pub.errorCode || 'article_publish_failed',
          status_code: pub.status_code || 0,
          detail: pub.detail || '',
        };
      }

      return {
        ok: true,
        article_id: pub.article_id,
        post_id: pub.post_id,
        published: true,
        article_url: pub.article_url,
        post_url: pub.post_url,
        via: 'official_api',
      };
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
        readMode: {
          type: 'string',
          enum: ['auto', 'graphql', 'dom'],
          description: 'READ 数据路径：auto=GraphQL 优先失败再 DOM；graphql=仅 GraphQL；dom=仅 DOM。v3.2 由 mode 重命名而来，与 visual-* 解耦。',
        },
      },
      required: ['username'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'profile',
    method: 'getProfile',
    execute: makeReadToolExecutor({
      toolName: 'x_get_profile',
      toolKey: 'x_get_profile',
      pageKey: 'profile',
      method: 'getProfile',
      cmdDef: {
        methodBase: 'getProfile',
        domSupported: true,
        apiSupported: true,
        defaultReadMode: 'auto',
      },
      buildTargetUrl: buildContractProfileTargetUrl,
    }),
  },
  {
    name: 'x_get_post',
    label: 'X Ops: Get Post Detail',
    description: '读取 X.com 帖子或 Article 详情（自动识别 t.co / /i/article/ /status/）。包括内容、统计、媒体。可选获取对话线程和回复。**deprecated 写参数**（reply/post/quote/thread/media）会透传到 v2 scripts/x-post.js，将在 v3.1 移到独立工具：x_create_tweet / x_reply_tweet / x_quote_tweet / x_create_thread。',
    parameters: {
      type: 'object',
      properties: {
        tweetUrl: {
          type: 'string',
          description: '推文/Article URL 或 ID。支持 /status/、/i/article/、t.co 短链；多条用逗号分隔。',
        },
        withThread: { type: 'boolean', description: '是否获取对话线程（上文）' },
        withReplies: { type: 'number', description: '获取回复数量（0 = 不获取）' },
        budgetMs: { type: 'number', description: 'post bridge wall-clock 预算毫秒（默认 60000，最大 300000）' },
        reply: { type: 'string', description: '【deprecated, v3.1 移到 x_reply_tweet】回复文本，需配合 tweetUrl' },
        post: { type: 'string', description: '【deprecated, v3.1 移到 x_create_tweet】发新帖正文（与 tweetUrl 互斥）' },
        quote: { type: 'string', description: '【deprecated, v3.1 移到 x_quote_tweet】引用推文，需配合 post 提供评论文本' },
        thread: { type: 'array', items: { type: 'string' }, description: '【deprecated, v3.1 移到 x_create_thread】串推数组' },
        dryRun: { type: 'boolean', description: '【deprecated】仅校验输入，不实际发布' },
        confirm: { type: 'boolean', description: '【deprecated】写操作必须显式 confirm=true 才会真发' },
        readMode: {
          type: 'string',
          enum: ['auto', 'graphql', 'dom'],
          description: 'READ 单条时：auto=GraphQL 优先失败再 DOM；graphql/dom=强制单一路径（写参数时忽略）。v3.2 由 mode 重命名而来。',
        },
      },
      required: ['tweetUrl'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'post',
    method: 'getPost',
    execute: makeXGetPostReadOrLegacyExecutor(),
  },
  {
    name: 'x_download_media',
    label: 'X Ops: Download Post Media',
    description: '读取 X 推文并将图片/视频下载到本地目录（会产生 local file side effect，不入 skill READ cache 的纯 JSON 语义）。',
    parameters: {
      type: 'object',
      properties: {
        tweetUrl: {
          type: 'string',
          description: '推文 URL 或 ID（如 https://x.com/user/status/123）',
        },
        outDir: {
          type: 'string',
          description: '媒体输出目录（默认 ./media/<tweetId>）',
        },
        readMode: {
          type: 'string',
          enum: ['auto', 'graphql', 'dom'],
          description: 'READ 数据路径，与 x_get_post 一致',
        },
      },
      required: ['tweetUrl'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    execute: async function downloadMediaTool(runtime, params, context = {}) {
      const p = params || {};
      const result = await getPost(runtime.ensureBot(), p.tweetUrl, {
        downloadMedia: true,
        outDir: p.outDir,
        readMode: p.readMode,
        recording: runtime.config.recording,
        runId: context.toolCallId,
      });
      return Object.assign({ ok: true }, result);
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
        readMode: {
          type: 'string',
          enum: ['auto', 'graphql', 'dom'],
          description: 'READ 数据路径：auto=GraphQL 优先失败再 DOM；graphql=仅 GraphQL；dom=仅 DOM。v3.2 由 mode 重命名而来。',
        },
      },
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'home',
    method: 'getHome',
    execute: makeReadToolExecutor({
      toolName: 'x_get_home_feed',
      toolKey: 'x_get_home_feed',
      pageKey: 'home',
      method: 'getHome',
      cmdDef: {
        methodBase: 'getHome',
        domSupported: true,
        apiSupported: true,
        defaultReadMode: 'auto',
      },
      buildTargetUrl: () => 'https://x.com/home',
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
  makeReadToolExecutor,
  makeXGetPostReadOrLegacyExecutor,
  makeNavigateToolExecutor,
  makeMonitorToolExecutor,
};
