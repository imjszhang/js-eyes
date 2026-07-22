'use strict';

const { createMcpServer, startStdioServer } = require('./src/server');
const { BrowserSession } = require('./src/browser-session');
const { resolveConfig, parseArgv } = require('./src/config');
const { FacadeError, errorResult, normalizeError } = require('./src/error-adapter');
const { createToolDefinitions, registerTools } = require('./src/tool-registry');

module.exports = {
  BrowserSession,
  FacadeError,
  createMcpServer,
  createToolDefinitions,
  errorResult,
  normalizeError,
  parseArgv,
  registerTools,
  resolveConfig,
  startStdioServer,
};
