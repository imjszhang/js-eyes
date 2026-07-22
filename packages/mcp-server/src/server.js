'use strict';

const pkg = require('../package.json');
const { BrowserSession } = require('./browser-session');
const { createLogger } = require('./logger');
const { NativeMcpServer } = require('./protocol-server');
const { StdioServerTransport } = require('./stdio-transport');
const { createToolDefinitions, registerTools } = require('./tool-registry');

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
  const definitions = createToolDefinitions(session, config);
  registerTools(server, definitions, logger);
  return { server, session, definitions, logger };
}

async function startStdioServer(config, options = {}) {
  const instance = createMcpServer(config, options);
  const transport = options.transport || new StdioServerTransport();
  await instance.server.connect(transport);
  return { ...instance, transport };
}

module.exports = { INSTRUCTIONS, createMcpServer, startStdioServer };
