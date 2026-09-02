'use strict';

const pkg = require('./package.json');
const { BrowserAutomation } = require('@js-eyes/client-sdk');
const { runTool } = require('./lib/runTool');
const { Session } = require('./lib/session');
const { resolveRuntimeConfig } = require('./lib/runtimeConfig');
const { PAGE_PROFILES } = require('./lib/config');
const targets = require('./lib/toolTargets');

const CLI_COMMANDS = [
  { name: 'doctor', description: '连通性 + bridge + probe + state 诊断' },
  { name: 'search', description: 'Google 网页搜索' },
  { name: 'news', description: 'Google 新闻搜索' },
  { name: 'images', description: 'Google 图片搜索' },
  { name: 'scholar', description: 'Google Scholar 搜索' },
  { name: 'session-state', description: '登录态' },
  { name: 'navigate-search', description: '导航到搜索结果（INTERACTIVE）' },
];

const READ_CAPS = ['browser.tabs.read', 'browser.navigation', 'browser.script.execute'];

const SEARCH_PARAMS = {
  query: { type: 'string', description: '搜索关键词' },
  limit: { type: 'number', description: '结果数上限，默认 10，最大 50' },
  maxPages: { type: 'number', description: '最大页数，默认 1，最大 5' },
  language: { type: 'string', description: 'hl 语言代码，如 zh-CN / en' },
  region: { type: 'string', description: 'gl 地区代码，如 us / cn' },
  safeSearch: { type: 'string', enum: ['active', 'off'] },
};

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

function makeSearchExecutor({ toolName, pageKey, vertical }) {
  return async function execute(runtime, params, context = {}) {
    const args = Object.assign({}, params || {}, { vertical, query: params && (params.query || params.q) });
    const targetUrl = targets.searchUrl(args);
    return runTool(runtime.ensureBot(), {
      toolName,
      pageKey,
      method: 'extractPage',
      args,
      targetUrl,
      options: {
        wsEndpoint: runtime.config.serverUrl,
        recording: runtime.config.recording,
        runId: context.toolCallId,
        forceNewTab: true,
        closeCreatedTab: true,
        navigateOnReuse: false,
        reuseAnyGoogleTab: false,
        createUrl: targetUrl,
      },
    });
  };
}

function makeNavigateToolExecutor({ pageKey, method, toolName }) {
  return async function execute(runtime, params, context = {}) {
    const startedAt = Date.now();
    const vertical = (params && params.vertical) || 'web';
    const resolvedPage = vertical === 'scholar' ? 'scholar' : (pageKey || 'search');
    const session = new Session({
      opts: {
        page: resolvedPage,
        bot: runtime.ensureBot(),
        verbose: false,
        wsEndpoint: runtime.config.serverUrl,
        createIfMissing: true,
        navigateOnReuse: false,
        reuseAnyGoogleTab: true,
        forceNewTab: false,
        closeCreatedTab: false,
        createUrl: targets.homeUrl(vertical),
      },
    });
    try {
      await session.connect();
      await session.resolveTarget();
      await session.ensureBridge();
      const navResp = await session.callApi(method, [params || {}]);
      if (!navResp || !navResp.ok) {
        return {
          platform: 'google',
          toolName,
          pageKey: resolvedPage,
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
        platform: 'google',
        toolName,
        pageKey: resolvedPage,
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
    name: 'google_search',
    risk: 'read',
    capabilities: READ_CAPS,
    label: 'Google Ops: Search',
    description: 'Google 网页搜索（DOM-first，临时标签页，不访问结果外链）',
    parameters: {
      type: 'object',
      properties: SEARCH_PARAMS,
      required: ['query'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'search',
    method: 'extractPage',
    execute: makeSearchExecutor({ toolName: 'google_search', pageKey: 'search', vertical: 'web' }),
  },
  {
    name: 'google_search_news',
    risk: 'read',
    capabilities: READ_CAPS,
    label: 'Google Ops: News',
    description: 'Google 新闻搜索',
    parameters: {
      type: 'object',
      properties: Object.assign({}, SEARCH_PARAMS, {
        timeRange: { type: 'string', enum: ['h', 'd', 'w', 'm', 'y'], description: '时间范围' },
      }),
      required: ['query'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    execute: makeSearchExecutor({ toolName: 'google_search_news', pageKey: 'search', vertical: 'news' }),
  },
  {
    name: 'google_search_images',
    risk: 'read',
    capabilities: READ_CAPS,
    label: 'Google Ops: Images',
    description: 'Google 图片搜索；只返回可见缩略图与来源页，不点击卡片',
    parameters: {
      type: 'object',
      properties: SEARCH_PARAMS,
      required: ['query'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    execute: makeSearchExecutor({ toolName: 'google_search_images', pageKey: 'search', vertical: 'images' }),
  },
  {
    name: 'google_search_scholar',
    risk: 'read',
    capabilities: READ_CAPS,
    label: 'Google Ops: Scholar',
    description: 'Google Scholar 搜索',
    parameters: {
      type: 'object',
      properties: Object.assign({}, SEARCH_PARAMS, {
        yearFrom: { type: 'number' },
        yearTo: { type: 'number' },
        sortBy: { type: 'string', enum: ['relevance', 'date'] },
      }),
      required: ['query'],
    },
    optional: true,
    interactive: false,
    destructive: false,
    execute: makeSearchExecutor({ toolName: 'google_search_scholar', pageKey: 'scholar', vertical: 'scholar' }),
  },
  {
    name: 'google_session_state',
    risk: 'read',
    capabilities: READ_CAPS,
    label: 'Google Ops: Session State',
    description: '读取当前 Google tab 是否已登录（不返回邮箱或 cookie）',
    parameters: { type: 'object', properties: {}, required: [] },
    optional: true,
    interactive: false,
    destructive: false,
    pageKey: 'search',
    method: 'sessionState',
    async execute(runtime, params, context = {}) {
      return runTool(runtime.ensureBot(), {
        toolName: 'google_session_state',
        pageKey: 'search',
        method: 'sessionState',
        args: params || {},
        targetUrl: null,
        options: {
          wsEndpoint: runtime.config.serverUrl,
          recording: runtime.config.recording,
          runId: context.toolCallId,
          forceNewTab: false,
          reuseAnyGoogleTab: true,
          closeCreatedTab: true,
          createIfMissing: true,
          createUrl: 'https://www.google.com/',
        },
      });
    },
  },
  {
    name: 'google_navigate_search',
    risk: 'interactive',
    capabilities: READ_CAPS,
    label: 'Google Ops: Navigate Search',
    description: '仅 location.assign 到 Google / Scholar 搜索页，保留标签页',
    parameters: {
      type: 'object',
      properties: Object.assign({}, SEARCH_PARAMS, {
        vertical: { type: 'string', enum: ['web', 'news', 'images', 'scholar'] },
        timeRange: { type: 'string', enum: ['h', 'd', 'w', 'm', 'y'] },
        yearFrom: { type: 'number' },
        yearTo: { type: 'number' },
        sortBy: { type: 'string', enum: ['relevance', 'date'] },
      }),
      required: ['query'],
    },
    optional: true,
    interactive: true,
    destructive: false,
    execute: makeNavigateToolExecutor({
      toolName: 'google_navigate_search',
      pageKey: 'search',
      method: 'navigateSearch',
    }),
  },
];

const skillCapabilities = {
  browser: ['tabs.read', 'navigation', 'script.execute', 'screenshot'],
  network: { direct: false, hosts: [] },
  filesystem: ['skillData'],
  process: [],
  secrets: [],
  background: false,
};

const skillRequirements = {
  server: true,
  browserExtension: true,
  login: false,
  platforms: ['google.com', 'scholar.google.com'],
};

module.exports = {
  capabilities: skillCapabilities,
  requirements: skillRequirements,
  id: pkg.name,
  name: 'JS Google Ops Skill',
  version: pkg.version,
  description: pkg.description,
  runtime: {
    requiresServer: true,
    requiresBrowserExtension: true,
    platforms: ['google.com', 'scholar.google.com'],
    pageProfiles: Object.keys(PAGE_PROFILES),
  },
  cli: {
    entry: './cli/index.js',
    commands: CLI_COMMANDS,
  },
  createRuntime,
  TOOL_DEFINITIONS,
};
