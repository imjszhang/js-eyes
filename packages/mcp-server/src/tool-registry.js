'use strict';

const { z } = require('zod');
const { errorResult, FacadeError } = require('./error-adapter');
const { dataResult, screenshotResult } = require('./result-adapter');

const target = z.string().min(1).max(200).optional()
  .describe('Extension clientId or unique browser name.');
const tabId = z.number().int().nonnegative().describe('Browser tab ID.');
const timeout = z.number().positive().max(1800).optional()
  .describe('Operation timeout in seconds.');

function annotations(options = {}) {
  return {
    readOnlyHint: Boolean(options.readOnly),
    destructiveHint: Boolean(options.destructive),
    idempotentHint: Boolean(options.idempotent),
    openWorldHint: Boolean(options.openWorld),
  };
}

function createToolDefinitions(session, config, skillService = null) {
  const maxChars = config.maxTextChars || 100000;
  const safe = [
    {
      name: 'browser_status',
      title: 'JS Eyes: Browser Status',
      description: 'Check JS Eyes server reachability and list connected browser extensions.',
      inputSchema: z.object({}),
      annotations: annotations({ readOnly: true, idempotent: true }),
      async execute() {
        const status = await session.status();
        return dataResult(status.healthy ? 'JS Eyes is ready.' : 'JS Eyes is not ready.', status, { maxChars });
      },
    },
    {
      name: 'browser_list_clients',
      title: 'JS Eyes: List Browser Clients',
      description: 'List browser extensions connected to the local JS Eyes server.',
      inputSchema: z.object({}),
      annotations: annotations({ readOnly: true, idempotent: true }),
      async execute() {
        const clients = await session.listClients();
        return dataResult(`Connected browser extensions: ${clients.length}`, clients, {
          maxChars,
          structured: { clients },
        });
      },
    },
    {
      name: 'browser_list_tabs',
      title: 'JS Eyes: List Tabs',
      description: 'List open browser tabs. Without target, tabs from all connected extensions are returned.',
      inputSchema: z.object({ target, timeout }),
      annotations: annotations({ readOnly: true, idempotent: true }),
      async execute(args) {
        const requested = args.target || config.target || undefined;
        const resolvedTarget = requested
          ? await session.resolveTarget(requested)
          : undefined;
        const result = await session.getBot().getTabs({
          ...(resolvedTarget ? { target: resolvedTarget } : {}),
          timeout: args.timeout || config.requestTimeout,
        });
        return dataResult(`Open tabs: ${(result.tabs || []).length}`, result, { maxChars });
      },
    },
    {
      name: 'browser_open_url',
      title: 'JS Eyes: Open URL',
      description: 'Open a URL in a new tab or navigate an existing tab. JS Eyes egress policy applies.',
      inputSchema: z.object({
        url: z.string().url().max(8192),
        tabId: z.number().int().nonnegative().optional(),
        windowId: z.number().int().nonnegative().optional(),
        target,
        timeout,
      }),
      annotations: annotations({ openWorld: true }),
      async execute(args) {
        const options = await session.operationOptions(args.target, { timeout: args.timeout });
        const openedTabId = await session.getBot().openUrl(
          args.url,
          args.tabId ?? null,
          args.windowId ?? null,
          options,
        );
        return dataResult(`Opened ${args.url} in tab ${openedTabId}.`, {
          url: args.url,
          tabId: openedTabId,
          target: options.target,
        }, { maxChars });
      },
    },
    {
      name: 'browser_close_tab',
      title: 'JS Eyes: Close Tab',
      description: 'Close a browser tab.',
      inputSchema: z.object({ tabId, target, timeout }),
      annotations: annotations({ destructive: true, idempotent: true }),
      async execute(args) {
        const options = await session.operationOptions(args.target, { timeout: args.timeout });
        await session.getBot().closeTab(args.tabId, options);
        return dataResult(`Closed tab ${args.tabId}.`, {
          tabId: args.tabId,
          target: options.target,
          closed: true,
        }, { maxChars });
      },
    },
    {
      name: 'browser_get_html',
      title: 'JS Eyes: Get Page HTML',
      description: 'Read HTML from a browser tab. Output is truncated to the requested character limit.',
      inputSchema: z.object({
        tabId,
        target,
        timeout,
        maxChars: z.number().int().min(1000).max(1000000).optional(),
      }),
      annotations: annotations({ readOnly: true, idempotent: true }),
      async execute(args) {
        const options = await session.operationOptions(args.target, { timeout: args.timeout });
        const html = await session.getBot().getTabHtml(args.tabId, options);
        const limit = args.maxChars || maxChars;
        return dataResult('', html || '', {
          maxChars: limit,
          structured: {
            tabId: args.tabId,
            target: options.target,
            html: String(html || '').slice(0, limit),
          },
        });
      },
    },
    {
      name: 'browser_get_page_info',
      title: 'JS Eyes: Get Page Info',
      description: 'Read URL, title, status, and other metadata from a browser tab.',
      inputSchema: z.object({ tabId, target, timeout }),
      annotations: annotations({ readOnly: true, idempotent: true }),
      async execute(args) {
        const options = await session.operationOptions(args.target, { timeout: args.timeout });
        const info = await session.getBot().getPageInfo(args.tabId, options);
        return dataResult(`Page information for tab ${args.tabId}`, {
          ...info,
          tabId: args.tabId,
          target: options.target,
        }, { maxChars });
      },
    },
    {
      name: 'browser_take_screenshot',
      title: 'JS Eyes: Take Screenshot',
      description: 'Capture a browser tab and return native MCP image content.',
      inputSchema: z.object({
        tabId,
        target,
        timeout,
        format: z.enum(['png', 'jpeg']).optional(),
        quality: z.number().int().min(0).max(100).optional(),
        fullPage: z.boolean().optional(),
      }),
      annotations: annotations({ readOnly: true, idempotent: true }),
      async execute(args) {
        const options = await session.operationOptions(args.target, {
          timeout: args.timeout,
          format: args.format,
          quality: args.quality,
          fullPage: args.fullPage,
        });
        const screenshot = await session.getBot().captureScreenshot(args.tabId, options);
        return screenshotResult(screenshot);
      },
    },
  ];

  const full = [
    {
      name: 'browser_execute_script',
      title: 'JS Eyes: Execute JavaScript',
      description: 'Execute JavaScript in a browser tab. This is a high-risk full-profile tool.',
      inputSchema: z.object({
        tabId,
        code: z.string().min(1).max(200000),
        target,
        timeout,
      }),
      annotations: annotations({ destructive: true, openWorld: true }),
      async execute(args) {
        const options = await session.operationOptions(args.target, { timeout: args.timeout });
        const result = await session.getBot().executeScript(args.tabId, args.code, options);
        return dataResult(`JavaScript executed in tab ${args.tabId}.`, result, {
          maxChars,
          structured: { tabId: args.tabId, target: options.target, result },
        });
      },
    },
    {
      name: 'browser_inject_css',
      title: 'JS Eyes: Inject CSS',
      description: 'Inject CSS into a browser tab. This is a high-risk full-profile tool.',
      inputSchema: z.object({
        tabId,
        css: z.string().min(1).max(200000),
        target,
        timeout,
      }),
      annotations: annotations({ destructive: true }),
      async execute(args) {
        const options = await session.operationOptions(args.target, { timeout: args.timeout });
        await session.getBot().injectCss(args.tabId, args.css, options);
        return dataResult(`CSS injected into tab ${args.tabId}.`, {
          tabId: args.tabId,
          target: options.target,
          injected: true,
        }, { maxChars });
      },
    },
    {
      name: 'browser_get_cookies',
      title: 'JS Eyes: Get Cookies',
      description: 'Read cookies for a browser tab. This sensitive tool is available only in the full profile.',
      inputSchema: z.object({ tabId, target, timeout }),
      annotations: annotations({ readOnly: true, idempotent: true }),
      async execute(args) {
        const options = await session.operationOptions(args.target, { timeout: args.timeout });
        const cookies = await session.getBot().getCookies(args.tabId, options);
        return dataResult(`Cookies returned: ${cookies.length}`, cookies, {
          maxChars,
          structured: { tabId: args.tabId, target: options.target, cookies },
        });
      },
    },
    {
      name: 'browser_get_cookies_by_domain',
      title: 'JS Eyes: Get Cookies By Domain',
      description: 'Read cookies by domain. This sensitive tool is available only in the full profile.',
      inputSchema: z.object({
        domain: z.string().min(1).max(253),
        includeSubdomains: z.boolean().optional(),
        target,
        timeout,
      }),
      annotations: annotations({ readOnly: true, idempotent: true }),
      async execute(args) {
        const options = await session.operationOptions(args.target, {
          timeout: args.timeout,
          includeSubdomains: args.includeSubdomains,
        });
        const cookies = await session.getBot().getCookiesByDomain(args.domain, options);
        return dataResult(`Cookies returned for ${args.domain}: ${cookies.length}`, cookies, {
          maxChars,
          structured: { domain: args.domain, target: options.target, cookies },
        });
      },
    },
    {
      name: 'browser_upload_file',
      title: 'JS Eyes: Upload File',
      description: 'Upload base64-encoded files through a page file input. Available only in the full profile.',
      inputSchema: z.object({
        tabId,
        files: z.array(z.object({
          base64: z.string().min(1).max(20000000),
          name: z.string().min(1).max(255),
          type: z.string().min(1).max(255),
        })).min(1).max(20),
        targetSelector: z.string().min(1).max(2000).optional(),
        target,
        timeout,
      }),
      annotations: annotations({ destructive: true }),
      async execute(args) {
        const totalBytes = args.files.reduce((sum, file) => sum + file.base64.length, 0);
        if (totalBytes > 50000000) {
          throw new FacadeError('JS_EYES_INVALID_ARGUMENT', 'Combined upload payload exceeds 50 MB.');
        }
        const options = await session.operationOptions(args.target, {
          timeout: args.timeout,
          targetSelector: args.targetSelector,
        });
        const uploadedFiles = await session.getBot().uploadFileToTab(args.tabId, args.files, options);
        return dataResult(`Uploaded files: ${uploadedFiles.length}`, uploadedFiles, {
          maxChars,
          structured: { tabId: args.tabId, target: options.target, uploadedFiles },
        });
      },
    },
  ];

  const skills = skillService ? [
    {
      name: 'skill_list',
      title: 'JS Eyes: List Skills',
      description: 'List active JS Eyes Skills available through the host-neutral skill runtime.',
      inputSchema: z.object({}),
      annotations: annotations({ readOnly: true, idempotent: true }),
      async execute() {
        const items = await skillService.list();
        return dataResult(`Active skills: ${items.length}`, { skills: items }, { maxChars });
      },
    },
    {
      name: 'skill_describe',
      title: 'JS Eyes: Describe Skill',
      description: 'Describe one active Skill, including tools, schemas, risk, and capabilities.',
      inputSchema: z.object({ skillId: z.string().min(1).max(300) }),
      annotations: annotations({ readOnly: true, idempotent: true }),
      async execute(args) {
        const skill = await skillService.describe(args.skillId);
        if (!skill) throw new FacadeError('JS_EYES_SKILL_NOT_FOUND', `Skill is not active: ${args.skillId}`);
        return dataResult(`Skill ${args.skillId}`, skill, { maxChars });
      },
    },
    {
      name: 'skill_call',
      title: 'JS Eyes: Call Skill Tool',
      description: 'Call a tool exposed by an active JS Eyes Skill using the shared runtime.',
      inputSchema: z.object({
        skillId: z.string().min(1).max(300),
        tool: z.string().min(1).max(300),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: annotations({
        readOnly: config.toolProfile !== 'full',
        destructive: config.toolProfile === 'full',
        openWorld: true,
      }),
      async execute(args) {
        const result = await skillService.call(args.skillId, args.tool, args.args || {});
        if (result && Array.isArray(result.content)) return result;
        return dataResult(`Skill call ${args.skillId}/${args.tool}`, result, { maxChars });
      },
    },
  ] : [];

  return config.toolProfile === 'full' ? [...safe, ...full, ...skills] : [...safe, ...skills];
}

function registerTools(server, definitions, logger = console) {
  for (const definition of definitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.annotations,
      },
      async (args) => {
        try {
          return await definition.execute(args || {});
        } catch (error) {
          const result = errorResult(error);
          logger.warn(`${definition.name} failed (${result.structuredContent.code})`);
          return result;
        }
      },
    );
  }
  return definitions;
}

module.exports = { annotations, createToolDefinitions, registerTools };
