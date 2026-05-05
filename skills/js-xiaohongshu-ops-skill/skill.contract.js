'use strict';

/**
 * skill.contract.js（v2.1+ 工厂化版本）
 *
 * 与 skills/js-x-ops-skill/skill.contract.js 同形态：
 *   - makeReadToolExecutor / makeBridgeReadExecutor / makeNavigateToolExecutor
 *   - 所有 READ / INTERACTIVE 工具显式 interactive / destructive 标记
 *   - 工具执行经 lib/runTool.js（READ）或直接 bridge.navigateXxx（INTERACTIVE）
 *
 * 不引入 DESTRUCTIVE 工具（小红书 ops skill 永不发笔记 / 评论 / 点赞 / 收藏 / 关注）。
 */

const pkg = require('./package.json');
const { BrowserAutomation } = require('./lib/js-eyes-client');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');
const { runTool } = require('./lib/runTool');
const { Session } = require('./lib/session');
const { COMMANDS } = require('./lib/commands');
const targets = require('./lib/toolTargets');
const { MONITOR_TOOL_DEFINITIONS } = require('./lib/runMonitor');

const CLI_COMMANDS = Object.entries(COMMANDS)
  .filter(([, def]) => def.kind !== 'special' || def.help)
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

// ---------------------------------------------------------------------------
// 工厂：READ 工具（走 runTool）
// ---------------------------------------------------------------------------

function makeReadToolExecutor(spec) {
  return async function execute(runtime, params, context = {}) {
    return runTool(runtime.ensureBot(), {
      toolName: spec.toolName,
      pageKey: spec.pageKey,
      method: spec.method,
      cmdDef: spec.cmdDef,
      args: spec.toArgs ? spec.toArgs(params) : (params || {}),
      targetUrl: spec.toTargetUrl ? spec.toTargetUrl(params) : null,
      options: {
        wsEndpoint: runtime.config.serverUrl,
        recording: runtime.config.recording,
        runId: context.toolCallId,
        readMode: params && params.readMode,
        timeoutMs: spec.timeoutMs || 90000,
        navigateOnReuse: false,
        reuseAnyXhsTab: true,
        createUrl: spec.toTargetUrl ? spec.toTargetUrl(params) : 'https://www.xiaohongshu.com/',
      },
    });
  };
}

// 同名别名，明示 "bridge READ"
function makeBridgeReadExecutor(spec) { return makeReadToolExecutor(spec); }

// ---------------------------------------------------------------------------
// 工厂：INTERACTIVE navigate（仅 location.assign）
// ---------------------------------------------------------------------------

function makeNavigateToolExecutor(spec) {
  return async function execute(runtime, params /* , context */) {
    const browser = runtime.ensureBot();
    const session = new Session({
      opts: {
        page: spec.pageKey,
        bot: browser,
        verbose: false,
        wsEndpoint: runtime.config.serverUrl,
        createIfMissing: true,
        navigateOnReuse: false,
        reuseAnyXhsTab: true,
        createUrl: 'https://www.xiaohongshu.com/',
      },
    });
    const startedAt = Date.now();
    try {
      await session.connect();
      await session.resolveTarget();
      await session.ensureBridge();
      const navResp = await session.callApi(spec.method, [spec.toArgs ? spec.toArgs(params) : (params || {})]);
      if (!navResp || !navResp.ok) {
        return { ok: false, interactive: true, destructive: false, nav: navResp || null };
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
        platform: 'xiaohongshu',
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
      try { await session.close(); } catch {}
    }
  };
}

// ---------------------------------------------------------------------------
// 工具表
// ---------------------------------------------------------------------------

const READ_NOTE_DEF = {
  methodBase: 'getNote', domSupported: true, apiSupported: true, defaultReadMode: 'auto',
};
const READ_COMMENTS_DEF = {
  methodBase: 'getComments', domSupported: false, apiSupported: true, defaultReadMode: 'api',
};
const READ_SEARCH_DEF = {
  methodBase: 'search', domSupported: true, apiSupported: false, defaultReadMode: 'dom',
};
const READ_USER_DEF = {
  methodBase: 'getUser', domSupported: true, apiSupported: false, defaultReadMode: 'dom',
};
const READ_USER_NOTES_DEF = {
  methodBase: 'getUserNotes', domSupported: true, apiSupported: false, defaultReadMode: 'dom',
};

const TOOL_DEFINITIONS = [
  {
    name: 'xhs_get_note',
    label: 'XHS Ops: Get Note',
    description: '读取小红书笔记详情（DOM 优先 + API 兜底）。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '小红书笔记 URL（http(s)://…/explore/<id>?…）或短链' },
        readMode: { type: 'string', enum: ['auto', 'dom', 'api'], description: 'auto = DOM 优先 + API 兜底（默认）' },
        withComments: { type: 'boolean', description: '是否抓取评论（API 路径分页）' },
        maxCommentPages: { type: 'number', description: '评论翻页数（默认 0=不抓）' },
      },
      required: ['url'],
    },
    execute: makeReadToolExecutor({
      toolName: 'xhs_get_note',
      pageKey: 'note',
      method: 'getNote',
      cmdDef: READ_NOTE_DEF,
      toArgs: (p) => ({
        url: p.url,
        withComments: !!p.withComments,
        maxCommentPages: Number(p.maxCommentPages || 0),
      }),
      toTargetUrl: (p) => targets.noteUrl({ url: p.url }),
      timeoutMs: 90000,
    }),
  },
  {
    name: 'xhs_get_note_comments',
    label: 'XHS Ops: Get Note Comments',
    description: '读取小红书笔记评论（基于 edith API 分页，DOM 不主用）。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '笔记 URL' },
        maxCommentPages: { type: 'number', description: '翻页数（默认 1）' },
      },
      required: ['url'],
    },
    execute: makeReadToolExecutor({
      toolName: 'xhs_get_note_comments',
      pageKey: 'note',
      method: 'getComments',
      cmdDef: READ_COMMENTS_DEF,
      toArgs: (p) => ({
        url: p.url,
        maxCommentPages: Number(p.maxCommentPages || 1),
      }),
      toTargetUrl: (p) => targets.noteUrl({ url: p.url }),
      timeoutMs: 90000,
    }),
  },
  {
    name: 'xhs_session_state',
    label: 'XHS Ops: Session State',
    description: '读取小红书登录态（基于 cookie a1/web_session 与 DOM 用户名）。',
    interactive: false,
    destructive: false,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: makeReadToolExecutor({
      toolName: 'xhs_session_state',
      pageKey: 'note',
      method: 'sessionState',
      cmdDef: { legacyOnly: true },
      toArgs: () => ({}),
      toTargetUrl: () => null,
      timeoutMs: 30000,
    }),
  },
  // -------------------- v2.2 搜索域 --------------------
  {
    name: 'xhs_search_notes',
    label: 'XHS Ops: Search Notes',
    description: '小红书搜索（DOM 滚动 + 频道/筛选；可串行点开详情）。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        limit: { type: 'number', description: '返回笔记数上限（默认 10，最多 200）' },
        channelType: { type: 'string', enum: ['全部', '图文', '视频', '用户'], description: '频道（默认 全部）' },
        sortBy: { type: 'string', description: '排序选项标签（如「综合」「最新」「最多点赞」「最多评论」「最多收藏」）' },
        contentType: { type: 'string', description: '筛选面板「笔记类型」选项标签（不限/视频/图文）' },
        timeRange: { type: 'string', description: '筛选面板「发布时间」选项标签（不限/一天内/一周内/半年内）' },
        searchScope: { type: 'string', description: '筛选面板「搜索范围」选项标签（不限/已看过/未看过/已关注）' },
        extractDetails: { type: 'boolean', description: '是否依次点开每条笔记并读取详情（同 tab + back，开启后耗时显著上升）' },
        detailsLimit: { type: 'number', description: '点开详情的条数上限（默认 = limit，硬上限 20；建议 ≤10）' },
      },
      required: ['keyword'],
    },
    execute: makeReadToolExecutor({
      toolName: 'xhs_search_notes',
      pageKey: 'search',
      method: 'search',
      cmdDef: READ_SEARCH_DEF,
      toArgs: (p) => ({
        keyword: p.keyword,
        limit: p.limit,
        channelType: p.channelType || '全部',
        sortBy: p.sortBy,
        contentType: p.contentType,
        timeRange: p.timeRange,
        searchScope: p.searchScope,
        extractDetails: !!p.extractDetails,
        detailsLimit: p.detailsLimit ? Number(p.detailsLimit) : undefined,
      }),
      toTargetUrl: (p) => targets.searchUrl({ keyword: p.keyword }),
      timeoutMs: 360000,
    }),
  },
  // -------------------- v2.3 用户域 --------------------
  {
    name: 'xhs_get_user',
    label: 'XHS Ops: Get User',
    description: '读取小红书用户主页资料（昵称、签名、关注/粉丝/获赞）。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: '用户 ID' },
      },
      required: ['userId'],
    },
    execute: makeReadToolExecutor({
      toolName: 'xhs_get_user',
      pageKey: 'user',
      method: 'getUser',
      cmdDef: READ_USER_DEF,
      toArgs: (p) => ({ userId: p.userId }),
      toTargetUrl: (p) => targets.userUrl({ userId: p.userId }),
      timeoutMs: 60000,
    }),
  },
  {
    name: 'xhs_get_user_notes',
    label: 'XHS Ops: Get User Notes',
    description: '读取小红书用户笔记列表（滚动分页）。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: '用户 ID' },
        maxPages: { type: 'number', description: '滚动分页轮数上限（默认 3，最多 30）' },
      },
      required: ['userId'],
    },
    execute: makeReadToolExecutor({
      toolName: 'xhs_get_user_notes',
      pageKey: 'user',
      method: 'getUserNotes',
      cmdDef: READ_USER_NOTES_DEF,
      toArgs: (p) => ({ userId: p.userId, maxPages: Number(p.maxPages || 3) }),
      toTargetUrl: (p) => targets.userUrl({ userId: p.userId }),
      timeoutMs: 180000,
    }),
  },
  // -------------------- v2.2 INTERACTIVE 导航 --------------------
  {
    name: 'xhs_navigate_note',
    label: 'XHS Ops: Navigate Note',
    description: '导航到小红书笔记详情页（仅 location.assign，不模拟点击）。',
    interactive: true,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整笔记 URL（与 noteId 二选一）' },
        noteId: { type: 'string', description: '笔记 ID' },
      },
    },
    execute: makeNavigateToolExecutor({
      toolName: 'xhs_navigate_note',
      pageKey: 'note',
      method: 'navigateNote',
      toArgs: (p) => ({ url: p.url, noteId: p.noteId }),
    }),
  },
  {
    name: 'xhs_navigate_search',
    label: 'XHS Ops: Navigate Search',
    description: '导航到小红书搜索页（仅 location.assign）。',
    interactive: true,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
      },
    },
    execute: makeNavigateToolExecutor({
      toolName: 'xhs_navigate_search',
      pageKey: 'search',
      method: 'navigateSearch',
      toArgs: (p) => ({ keyword: p.keyword }),
    }),
  },
  {
    name: 'xhs_navigate_user',
    label: 'XHS Ops: Navigate User',
    description: '导航到小红书用户主页（仅 location.assign）。',
    interactive: true,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: '用户 ID' },
      },
      required: ['userId'],
    },
    execute: makeNavigateToolExecutor({
      toolName: 'xhs_navigate_user',
      pageKey: 'user',
      method: 'navigateUser',
      toArgs: (p) => ({ userId: p.userId }),
    }),
  },
  {
    name: 'xhs_navigate_home',
    label: 'XHS Ops: Navigate Home',
    description: '导航到小红书探索流首页（仅 location.assign）。',
    interactive: true,
    destructive: false,
    parameters: { type: 'object', properties: {} },
    execute: makeNavigateToolExecutor({
      toolName: 'xhs_navigate_home',
      pageKey: 'home',
      method: 'navigateHome',
      toArgs: () => ({}),
    }),
  },
  // -------------------- v3.0 受控 monitor AI 工具 --------------------
  // monitor 的 init / check / daemon / stop 不进 AI 工具列表（会触发 webhook）
  ...MONITOR_TOOL_DEFINITIONS,
];

function listTools() {
  return TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    interactive: !!tool.interactive,
    destructive: !!tool.destructive,
  }));
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
  name: 'JS Xiaohongshu Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    platforms: ['xiaohongshu.com', 'xhslink.com'],
  },
  cli: {
    entry: './cli/index.js',
    commands: CLI_COMMANDS,
  },
  openclaw: { tools: listTools() },
  tools: listTools(),
  TOOL_DEFINITIONS,
  makeReadToolExecutor,
  makeBridgeReadExecutor,
  makeNavigateToolExecutor,
  createRuntime,
  createOpenClawAdapter,
};
