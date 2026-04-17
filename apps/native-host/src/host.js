'use strict';

const fs = require('fs');
const path = require('path');
const { encodeMessage, createFrameReader } = require('./codec');

const pkg = require('../package.json');

function tryRequire(specifier) {
  try {
    return require(specifier);
  } catch {
    return null;
  }
}

const runtimePaths = tryRequire('@js-eyes/runtime-paths');
const tokenModule = tryRequire('@js-eyes/runtime-paths/token');
const configModule = tryRequire('@js-eyes/config');
const protocolModule = tryRequire('@js-eyes/protocol');

const DEFAULT_HOST = protocolModule?.DEFAULT_SERVER_HOST || 'localhost';
const DEFAULT_PORT = protocolModule?.DEFAULT_SERVER_PORT || 18080;

function appendLog(line) {
  try {
    const paths = runtimePaths?.getPaths?.();
    if (!paths?.logsDir) return;
    try {
      fs.mkdirSync(paths.logsDir, { recursive: true });
    } catch {}
    const logFile = path.join(paths.logsDir, 'native-host.log');
    const record = `${new Date().toISOString()} ${line}\n`;
    fs.appendFileSync(logFile, record);
  } catch {
    // logging must not break the host
  }
}

function readServerToken() {
  if (process.env.JS_EYES_SERVER_TOKEN) {
    return process.env.JS_EYES_SERVER_TOKEN;
  }
  if (tokenModule?.readToken) {
    try {
      return tokenModule.readToken();
    } catch {
      return null;
    }
  }
  if (runtimePaths?.getPaths) {
    try {
      const paths = runtimePaths.getPaths();
      if (paths.tokenFile && fs.existsSync(paths.tokenFile)) {
        return fs.readFileSync(paths.tokenFile, 'utf8').trim() || null;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function readServerConfig() {
  if (configModule?.loadConfig) {
    try {
      const config = configModule.loadConfig() || {};
      return {
        host: config.serverHost || DEFAULT_HOST,
        port: Number(config.serverPort || DEFAULT_PORT),
      };
    } catch {
      // fall through
    }
  }
  return { host: DEFAULT_HOST, port: DEFAULT_PORT };
}

function buildServerUrls() {
  const { host, port } = readServerConfig();
  const bracketedHost = host === '::1' ? '[::1]' : host;
  return {
    host,
    port,
    httpUrl: `http://${bracketedHost}:${port}`,
    wsUrl: `ws://${bracketedHost}:${port}`,
  };
}

function handleMessage(message) {
  const type = message && typeof message === 'object' ? message.type : null;
  switch (type) {
    case 'ping':
      return { ok: true, type: 'pong', version: pkg.version };
    case 'get-config': {
      const urls = buildServerUrls();
      const token = readServerToken();
      if (!token) {
        appendLog('get-config: token-missing');
        return {
          ok: false,
          error: 'token-missing',
          serverHost: urls.host,
          serverPort: urls.port,
          serverUrl: urls.wsUrl,
          httpUrl: urls.httpUrl,
        };
      }
      appendLog('get-config: ok');
      return {
        ok: true,
        serverHost: urls.host,
        serverPort: urls.port,
        serverUrl: urls.wsUrl,
        httpUrl: urls.httpUrl,
        serverToken: token,
      };
    }
    default:
      appendLog(`unknown-type: ${String(type).slice(0, 32)}`);
      return { ok: false, error: 'unknown-type' };
  }
}

function write(stream, payload) {
  stream.write(encodeMessage(payload));
}

function run(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;

  appendLog(`start pid=${process.pid}`);

  const reader = createFrameReader({
    onMessage: (message) => {
      try {
        const reply = handleMessage(message);
        write(output, reply);
      } catch (error) {
        appendLog(`handler-error: ${error.message}`);
        try {
          write(output, { ok: false, error: 'internal-error' });
        } catch {}
      }
    },
    onError: (error) => {
      appendLog(`decode-error: ${error.message}`);
    },
  });

  input.on('data', reader);
  input.on('end', () => {
    appendLog('stdin-end');
    process.exit(0);
  });
  input.on('error', (error) => {
    appendLog(`stdin-error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildServerUrls,
  handleMessage,
  readServerConfig,
  readServerToken,
  run,
};
