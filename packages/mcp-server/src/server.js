'use strict';

const pkg = require('../package.json');
const { BrowserSession } = require('./browser-session');
const { createLogger } = require('./logger');
const { NativeMcpServer } = require('./protocol-server');
const { StdioServerTransport } = require('./stdio-transport');
const { createToolDefinitions, registerTools } = require('./tool-registry');
const { McpSkillService } = require('./skill-service');

const INSTRUCTIONS = [
  'Use browser_list_clients or browser_list_tabs before a browser-scoped operation.',
  'When multiple browser extensions are connected, pass an explicit target clientId.',
  'JS Eyes server policy may require approval before opening a new destination.',
].join(' ');

function createMcpServer(config, options = {}) {
  const logger = options.logger || createLogger(config.logLevel);
  const session = options.session || new BrowserSession(config, {
    logger,
    automationFactory: options.automationFactory,
  });
  const server = options.server || new NativeMcpServer(
    { name: 'js-eyes', version: pkg.version },
    { instructions: INSTRUCTIONS },
  );
  const skillService = options.skillService === false
    ? null
    : (options.skillService || new McpSkillService(config, session, { logger }));
  const definitions = createToolDefinitions(session, config, skillService);
  registerTools(server, definitions, logger);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    const errors = [];
    for (const cleanup of [
      skillService && (() => skillService.dispose()),
      () => session.disconnect(),
      () => server.close(),
    ].filter(Boolean)) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'MCP server close failed');
  };
  return { server, session, skillService, definitions, logger, close };
}

async function startStdioServer(config, options = {}) {
  const instance = createMcpServer(config, options);
  const transport = options.transport || new StdioServerTransport();
  await instance.server.connect(transport);
  return { ...instance, transport };
}

module.exports = { INSTRUCTIONS, createMcpServer, startStdioServer };
