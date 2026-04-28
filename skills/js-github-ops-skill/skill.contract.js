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
  { name: 'probe', description: '页面指纹' },
  { name: 'state', description: '当前 profile 状态' },
  { name: 'session-state', description: '登录态（meta）' },
  { name: 'get-repo', description: 'REST 读取仓库' },
  { name: 'list-issues', description: '列出 Issues' },
  { name: 'get-issue', description: '读取单条 Issue' },
  { name: 'navigate-repo', description: '导航到仓库（INTERACTIVE）' },
  { name: 'navigate-issues', description: '导航到 Issues 列表（INTERACTIVE）' },
  { name: 'navigate-issue', description: '导航到 Issue（INTERACTIVE）' },
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
        reuseAnyGithubTab: true,
        createUrl: targetUrl || 'https://github.com/',
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
        reuseAnyGithubTab: true,
        createUrl: 'https://github.com/',
      },
    });
    try {
      await session.connect();
      await session.resolveTarget();
      await session.ensureBridge();
      const navResp = await session.callApi(method, [params || {}]);
      if (!navResp || !navResp.ok) {
        return {
          platform: 'github',
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
        platform: 'github',
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
    name: 'github_session_state',
    label: 'GitHub Ops: Session State',
    description: '读取浏览器当前 GitHub 页推断的登录态（meta[name=user-login]）',
    parameters: { type: 'object', properties: {}, required: [] },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'repo',
    method: 'sessionState',
    execute: makeReadToolExecutor({
      toolName: 'github_session_state',
      pageKey: 'repo',
      method: 'sessionState',
      buildTargetUrl: () => null,
    }),
  },
  {
    name: 'github_get_repo',
    label: 'GitHub Ops: Get Repo',
    description: '通过 GitHub REST API 读取公开仓库元数据（stars、forks、默认分支等）',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: '仓库 owner（与 repo 成对，或与 slug 二选一）' },
        repo: { type: 'string' },
        slug: { type: 'string', description: 'owner/repo 缩写，例如 octocat/Hello-World' },
      },
      required: [],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'repo',
    method: 'getRepo',
    execute: makeReadToolExecutor({
      toolName: 'github_get_repo',
      pageKey: 'repo',
      method: 'getRepo',
      buildTargetUrl: (p) => targets.repoRootUrl(p),
    }),
  },
  {
    name: 'github_list_issues',
    label: 'GitHub Ops: List Issues',
    description: '列出仓库 Issues（默认排除 PR；api.github.com）',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        slug: { type: 'string' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
        perPage: { type: 'number', description: '每页条数，默认 25，最大 100' },
        page: { type: 'number', description: '页码，从 1 起' },
        excludePulls: { type: 'boolean', default: true },
      },
      required: [],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'issues',
    method: 'listIssues',
    execute: makeReadToolExecutor({
      toolName: 'github_list_issues',
      pageKey: 'issues',
      method: 'listIssues',
      buildTargetUrl: (p) => targets.issuesListUrl(p),
    }),
  },
  {
    name: 'github_get_issue',
    label: 'GitHub Ops: Get Issue',
    description: '读取单条 Issue 详情（含正文摘要）',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        slug: { type: 'string' },
        number: { type: 'number' },
        bodyMaxLen: { type: 'number', description: '正文最大长度，默认 12000' },
      },
      required: ['number'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'issue',
    method: 'getIssue',
    execute: makeReadToolExecutor({
      toolName: 'github_get_issue',
      pageKey: 'issue',
      method: 'getIssue',
      buildTargetUrl: (p) => targets.issueDetailUrl(p),
    }),
  },
  {
    name: 'github_navigate_repo',
    label: 'GitHub Ops: Navigate Repo',
    description: '仅 location.assign 到仓库根路径',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        slug: { type: 'string' },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'repo',
    method: 'navigateRepo',
    execute: makeNavigateToolExecutor({ toolName: 'github_navigate_repo', pageKey: 'repo', method: 'navigateRepo' }),
  },
  {
    name: 'github_navigate_issues',
    label: 'GitHub Ops: Navigate Issues',
    description: '导航到 Issues 列表，可选 q 查询串',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        slug: { type: 'string' },
        q: { type: 'string' },
      },
      required: [],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'issues',
    method: 'navigateIssues',
    execute: makeNavigateToolExecutor({ toolName: 'github_navigate_issues', pageKey: 'issues', method: 'navigateIssues' }),
  },
  {
    name: 'github_navigate_issue',
    label: 'GitHub Ops: Navigate Issue',
    description: '导航到指定 Issue 页',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        slug: { type: 'string' },
        number: { type: 'number' },
      },
      required: ['number'],
    },
    optional: true,
    interactive: true,
    destructive: false,
    pageKey: 'issue',
    method: 'navigateIssue',
    execute: makeNavigateToolExecutor({ toolName: 'github_navigate_issue', pageKey: 'issue', method: 'navigateIssue' }),
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
  name: 'JS GitHub Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    platforms: ['github.com'],
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
