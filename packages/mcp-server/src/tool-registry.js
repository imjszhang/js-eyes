'use strict';

const { z } = require('zod');
const {
  invokeBrowserOperation,
  listBrowserOperationsForProfile,
} = require('@js-eyes/protocol');
const { errorResult, FacadeError } = require('./error-adapter');
const { dataResult, screenshotResult } = require('./result-adapter');

function annotations(options = {}) {
  return {
    readOnlyHint: Boolean(options.readOnly),
    destructiveHint: Boolean(options.destructive),
    idempotentHint: Boolean(options.idempotent),
    openWorldHint: Boolean(options.openWorld),
  };
}

function zodFromJsonSchema(schema) {
  if (!schema || schema.type !== 'object') return z.object({});
  const shape = {};
  const required = new Set(schema.required || []);
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    let field;
    if (prop.type === 'string') {
      field = z.string();
      if (prop.format === 'uri' || prop.format === 'url') field = field.url();
      if (prop.minLength != null) field = field.min(prop.minLength);
      if (prop.maxLength != null) field = field.max(prop.maxLength);
      if (Array.isArray(prop.enum)) field = z.enum(prop.enum);
    } else if (prop.type === 'integer') {
      field = z.number().int();
      if (prop.minimum != null) field = field.min(prop.minimum);
      if (prop.maximum != null) field = field.max(prop.maximum);
      if (prop.exclusiveMinimum != null) field = field.gt(prop.exclusiveMinimum);
    } else if (prop.type === 'number') {
      field = z.number();
      if (prop.minimum != null) field = field.min(prop.minimum);
      if (prop.maximum != null) field = field.max(prop.maximum);
      if (prop.exclusiveMinimum != null) field = field.gt(prop.exclusiveMinimum);
      if (prop.positive) field = field.positive();
    } else if (prop.type === 'boolean') {
      field = z.boolean();
    } else if (prop.type === 'array') {
      let item = /** @type {any} */ (z.unknown());
      if (prop.items?.type === 'object') {
        item = zodFromJsonSchema(prop.items);
      } else if (prop.items?.type === 'string') {
        item = z.string();
      }
      field = z.array(item);
      if (prop.minItems != null) field = field.min(prop.minItems);
      if (prop.maxItems != null) field = field.max(prop.maxItems);
    } else if (prop.type === 'object') {
      field = zodFromJsonSchema(prop);
    } else {
      field = z.unknown();
    }
    if (prop.description) field = field.describe(prop.description);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return z.object(shape);
}

function needsResolvedTarget(operation) {
  return operation.routing === 'extension' || operation.id === 'tabs.list';
}

async function runBrowserOperation(session, config, operation, args) {
  const maxChars = config.maxTextChars || 100000;

  if (operation.id === 'file.upload') {
    const totalBytes = (args.files || []).reduce((sum, file) => sum + String(file.base64 || '').length, 0);
    if (totalBytes > 50000000) {
      throw new FacadeError('JS_EYES_INVALID_ARGUMENT', 'Combined upload payload exceeds 50 MB.');
    }
  }

  let callOptions = {};
  if (operation.id === 'tabs.list') {
    const requested = args.target || config.target || undefined;
    if (requested) {
      callOptions.target = await session.resolveTarget(requested);
    }
    callOptions.timeout = args.timeout || config.requestTimeout;
  } else if (operation.id === 'clients.list') {
    callOptions.timeout = config.connectTimeout || config.requestTimeout;
  } else if (needsResolvedTarget(operation)) {
    // page.waitFor's timeout is wait duration; give the transport a buffer.
    let transportTimeout = args.timeout;
    if (operation.id === 'page.waitFor' && args.timeout != null) {
      transportTimeout = Number(args.timeout) + 5;
    }
    callOptions = await session.operationOptions(args.target, {
      timeout: transportTimeout,
      includeSubdomains: args.includeSubdomains,
      targetSelector: args.targetSelector,
      format: args.format,
      quality: args.quality,
      fullPage: args.fullPage,
    });
  }

  const raw = await invokeBrowserOperation(session.getBot(), operation, args, callOptions);

  switch (operation.id) {
    case 'tabs.list':
      return dataResult(`Open tabs: ${(raw.tabs || []).length}`, raw, { maxChars });
    case 'clients.list':
      return dataResult(`Connected browser extensions: ${raw.length}`, raw, {
        maxChars,
        structured: { clients: raw },
      });
    case 'url.open':
      return dataResult(`Opened ${args.url} in tab ${raw}.`, {
        url: args.url,
        tabId: raw,
        target: callOptions.target,
      }, { maxChars });
    case 'tab.close':
      return dataResult(`Closed tab ${args.tabId}.`, {
        tabId: args.tabId,
        target: callOptions.target,
        closed: true,
      }, { maxChars });
    case 'page.html': {
      const limit = args.maxChars || maxChars;
      return dataResult('', raw || '', {
        maxChars: limit,
        structured: {
          tabId: args.tabId,
          target: callOptions.target,
          html: String(raw || '').slice(0, limit),
        },
      });
    }
    case 'page.info':
      return dataResult(`Page information for tab ${args.tabId}`, {
        ...raw,
        tabId: args.tabId,
        target: callOptions.target,
      }, { maxChars });
    case 'screenshot.capture':
      return screenshotResult(raw);
    case 'script.execute':
      return dataResult(`JavaScript executed in tab ${args.tabId}.`, raw, {
        maxChars,
        structured: { tabId: args.tabId, target: callOptions.target, result: raw },
      });
    case 'style.inject':
      return dataResult(`CSS injected into tab ${args.tabId}.`, {
        tabId: args.tabId,
        target: callOptions.target,
        injected: true,
      }, { maxChars });
    case 'cookies.read':
      return dataResult(`Cookies returned: ${raw.length}`, raw, {
        maxChars,
        structured: { tabId: args.tabId, target: callOptions.target, cookies: raw },
      });
    case 'cookies.readDomain':
      return dataResult(`Cookies returned for ${args.domain}: ${raw.length}`, raw, {
        maxChars,
        structured: { domain: args.domain, target: callOptions.target, cookies: raw },
      });
    case 'file.upload':
      return dataResult(`Uploaded files: ${raw.length}`, raw, {
        maxChars,
        structured: { tabId: args.tabId, target: callOptions.target, uploadedFiles: raw },
      });
    default:
      return dataResult(operation.title || operation.id, raw, { maxChars });
  }
}

function createToolDefinitions(session, config, skillService = null) {
  const maxChars = config.maxTextChars || 100000;
  const browserTools = listBrowserOperationsForProfile(config.toolProfile)
    .filter((operation) => operation.mcpTool)
    .map((operation) => ({
      name: operation.mcpTool,
      title: operation.title,
      description: operation.description,
      inputSchema: zodFromJsonSchema(operation.inputSchema),
      annotations: annotations(operation.annotations || {}),
      async execute(args) {
        return runBrowserOperation(session, config, operation, args || {});
      },
    }));

  const statusTool = {
    name: 'browser_status',
    title: 'JS Eyes: Browser Status',
    description: 'Check JS Eyes server reachability and list connected browser extensions.',
    inputSchema: z.object({}),
    annotations: annotations({ readOnly: true, idempotent: true }),
    async execute() {
      const status = await session.status();
      return dataResult(status.healthy ? 'JS Eyes is ready.' : 'JS Eyes is not ready.', status, { maxChars });
    },
  };

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

  // Keep browser_status first for stable discovery order, then operations table order.
  return [statusTool, ...browserTools, ...skills];
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

module.exports = { annotations, createToolDefinitions, registerTools, zodFromJsonSchema };
