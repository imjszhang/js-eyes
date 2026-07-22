'use strict';

const { loadConfig } = require('@js-eyes/config');

const TOOL_PROFILES = Object.freeze(['safe', 'full']);
const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error', 'silent']);

function parsePositiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function takeValue(argv, index, name) {
  const arg = argv[index];
  const prefix = `${name}=`;
  if (arg.startsWith(prefix)) return { value: arg.slice(prefix.length), consumed: 1 };
  if (arg === name && argv[index + 1] && !argv[index + 1].startsWith('--')) {
    return { value: argv[index + 1], consumed: 2 };
  }
  if (arg === name) throw new Error(`${name} requires a value`);
  return null;
}

function parseArgv(argv = []) {
  const parsed = {};
  for (let index = 0; index < argv.length;) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      index += 1;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      parsed.version = true;
      index += 1;
      continue;
    }
    let match = null;
    for (const [flag, key] of [
      ['--server-url', 'serverUrl'],
      ['--target', 'target'],
      ['--tool-profile', 'toolProfile'],
      ['--connect-timeout', 'connectTimeout'],
      ['--request-timeout', 'requestTimeout'],
      ['--log-level', 'logLevel'],
    ]) {
      match = takeValue(argv, index, flag);
      if (match) {
        parsed[key] = match.value;
        index += match.consumed;
        break;
      }
    }
    if (match) continue;
    throw new Error(`unknown option: ${arg}`);
  }
  return parsed;
}

function normalizeWsUrl(value) {
  const url = String(value || '').trim();
  if (!url) throw new Error('server URL must not be empty');
  if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`;
  if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`;
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
  return `ws://${url}`;
}

function resolveConfig(options = {}) {
  const argv = options.argv || {};
  const env = options.env || process.env;
  const runtime = options.runtimeConfig || loadConfig();
  const runtimeUrl = `ws://${runtime.serverHost || 'localhost'}:${runtime.serverPort || 18080}`;

  const toolProfile = argv.toolProfile
    || env.JS_EYES_MCP_TOOL_PROFILE
    || 'safe';
  if (!TOOL_PROFILES.includes(toolProfile)) {
    throw new Error(`tool profile must be one of: ${TOOL_PROFILES.join(', ')}`);
  }

  const logLevel = argv.logLevel || env.JS_EYES_MCP_LOG_LEVEL || 'warn';
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`log level must be one of: ${LOG_LEVELS.join(', ')}`);
  }

  const connectTimeout = parsePositiveNumber(
    argv.connectTimeout || env.JS_EYES_MCP_CONNECT_TIMEOUT || 10,
    'connect timeout',
  );
  const requestTimeout = parsePositiveNumber(
    argv.requestTimeout
      || env.JS_EYES_MCP_REQUEST_TIMEOUT
      || runtime.requestTimeout
      || 30,
    'request timeout',
  );

  return Object.freeze({
    serverUrl: normalizeWsUrl(
      argv.serverUrl || env.JS_EYES_MCP_SERVER_URL || runtimeUrl,
    ),
    target: argv.target || env.JS_EYES_MCP_TARGET || null,
    toolProfile,
    connectTimeout,
    requestTimeout,
    logLevel,
    maxTextChars: 100000,
  });
}

module.exports = {
  LOG_LEVELS,
  TOOL_PROFILES,
  normalizeWsUrl,
  parseArgv,
  resolveConfig,
};
