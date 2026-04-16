'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const {
  handleConnection,
  createState,
  startCleanup,
  getExtensionSummaries,
} = require('./ws-handler');
const {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  PROTOCOL_VERSION,
  WS_CLOSE_CODE_AUTH_REQUIRED,
  isLoopbackHost,
  isOriginAllowed,
  resolveSecurityConfig,
} = require('@js-eyes/protocol');
const { ensureToken } = require('@js-eyes/runtime-paths/token');
const { checkAccess, WS_SUBPROTOCOL_PREFIX } = require('./auth');
const { createAuditLogger, NOOP_AUDIT } = require('./audit');
const { loadConfig } = tryLoadConfigModule();
const pkg = require('./package.json');

function tryLoadConfigModule() {
  try {
    return require('@js-eyes/config');
  } catch {
    return { loadConfig: () => ({}) };
  }
}

function resolveAuditLogger(options) {
  if (options.auditLogger) return options.auditLogger;
  if (!options.auditLogFile) return NOOP_AUDIT;
  return createAuditLogger({
    filePath: options.auditLogFile,
    fallbackLogger: options.logger || console,
  });
}

function resolveServerToken(options, security) {
  if (options.token) return { token: options.token, path: null, created: false };
  if (security.allowAnonymous && options.allowNoToken !== false) {
    return { token: null, path: null, created: false };
  }
  try {
    return ensureToken({ baseDir: options.baseDir });
  } catch (error) {
    const logger = options.logger || console;
    logger.warn?.(`[js-eyes-server] token 初始化失败: ${error.message}`);
    return { token: null, path: null, created: false };
  }
}

function createServer(options = {}) {
  const port = options.port || DEFAULT_SERVER_PORT;
  const host = options.host || DEFAULT_SERVER_HOST;
  const logger = options.logger || console;

  let config = {};
  try {
    config = options.config || loadConfig();
  } catch {
    config = {};
  }
  const security = options.security || resolveSecurityConfig(config);

  if (!isLoopbackHost(host) && !security.allowRemoteBind) {
    throw new Error(
      `拒绝绑定到非回环地址 "${host}"。如确需暴露到本机外，请设置 JS_EYES_ALLOW_REMOTE_BIND=1 或 config.security.allowRemoteBind=true。`,
    );
  }
  if (!isLoopbackHost(host)) {
    logger.warn?.(`[js-eyes-server] WARNING: binding to non-loopback host ${host}; 本地服务将对外可达`);
  }

  const audit = resolveAuditLogger({
    auditLogger: options.auditLogger,
    auditLogFile: options.auditLogFile,
    logger,
  });

  const { token: serverToken, path: tokenFilePath, created: tokenCreated } =
    resolveServerToken(options, security);

  if (security.allowAnonymous) {
    logger.warn?.(
      '[js-eyes-server] WARNING: allowAnonymous=true (or JS_EYES_INSECURE=1) — 服务端将接受未鉴权 / 未在白名单内的客户端，仅用于过渡兼容',
    );
  }
  if (tokenCreated && tokenFilePath) {
    logger.info?.(`[js-eyes-server] Generated new server token at ${tokenFilePath} (chmod 600)`);
  }

  const state = createState();
  state.serverToken = serverToken;
  state.security = security;
  state.audit = audit;
  state.pendingEgressDir = options.pendingEgressDir || null;

  let cleanupTimer = null;

  function originFromHeaders(req) {
    const raw = req.headers && (req.headers.origin || req.headers.Origin);
    return raw || null;
  }

  function applySecurityHeaders(headers) {
    headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'";
    headers['X-Content-Type-Options'] = 'nosniff';
    headers['X-Frame-Options'] = 'DENY';
    headers['Referrer-Policy'] = 'no-referrer';
    headers['Permissions-Policy'] = 'interest-cohort=()';
    return headers;
  }

  function jsonResponse(res, statusCode, data, req) {
    const body = JSON.stringify(data, null, 2);
    const baseHeaders = applySecurityHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    const origin = req ? originFromHeaders(req) : null;
    if (origin && isOriginAllowed(origin, security.allowedOrigins)) {
      baseHeaders['Access-Control-Allow-Origin'] = origin;
      baseHeaders['Vary'] = 'Origin';
      baseHeaders['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
      baseHeaders['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    }
    res.writeHead(statusCode, baseHeaders);
    res.end(body);
  }

  function handleHttpRequest(req, res) {
    const origin = originFromHeaders(req);

    if (req.method === 'OPTIONS') {
      const headers = applySecurityHeaders({ 'Cache-Control': 'no-store' });
      if (origin && isOriginAllowed(origin, security.allowedOrigins)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Vary'] = 'Origin';
        headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      jsonResponse(res, 405, { status: 'error', message: 'Method not allowed' }, req);
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || DEFAULT_SERVER_HOST}`);
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/api/browser/health') {
      jsonResponse(res, 200, {
        status: 'healthy',
        protocolVersion: PROTOCOL_VERSION,
        timestamp: new Date().toISOString(),
      }, req);
      return;
    }

    const access = checkAccess({
      token: serverToken,
      headers: req.headers,
      url: req.url,
      host: req.headers.host,
      origin,
      security,
      requireToken: Boolean(serverToken),
    });

    if (!access.allowed) {
      audit.write('http.reject', {
        path: pathname,
        origin,
        reason: access.reason,
        remote: req.socket?.remoteAddress,
      });
      jsonResponse(res, 401, {
        status: 'error',
        message: 'unauthorized',
        reason: access.reason,
      }, req);
      return;
    }

    if (access.anonymous) {
      logger.warn?.(`[js-eyes-server] anonymous HTTP access accepted (${pathname}) reason=${access.reason}`);
      audit.write('http.anonymous', {
        path: pathname,
        origin,
        reason: access.reason,
        remote: req.socket?.remoteAddress,
      });
    }

    audit.write('http.accept', {
      path: pathname,
      origin,
      anonymous: access.anonymous,
      remote: req.socket?.remoteAddress,
    });

    switch (pathname) {
      case '/':
        jsonResponse(res, 200, {
          name: 'js-eyes-server',
          version: pkg.version,
          protocolVersion: PROTOCOL_VERSION,
          websocket: `ws://${host}:${port}`,
          endpoints: ['/api/browser/status', '/api/browser/tabs', '/api/browser/clients', '/api/browser/health'],
          authRequired: Boolean(serverToken) && !security.allowAnonymous,
        }, req);
        break;
      case '/api/browser/status': {
        const browsers = getExtensionSummaries(state);
        const totalTabs = browsers.reduce((sum, browser) => sum + browser.tabCount, 0);
        jsonResponse(res, 200, {
          status: 'success',
          data: {
            isRunning: true,
            uptime: Math.floor(process.uptime()),
            protocolVersion: PROTOCOL_VERSION,
            serverVersion: pkg.version,
            authRequired: Boolean(serverToken) && !security.allowAnonymous,
            allowAnonymous: Boolean(security.allowAnonymous),
            connections: {
              extensions: browsers.map(({ clientId, browserName, connectedAt, tabCount }) => (
                { clientId, browserName, connectedAt, tabCount }
              )),
              automationClients: state.automationClients.size,
            },
            tabs: totalTabs,
            pendingRequests: state.pendingResponses.size,
          },
        }, req);
        break;
      }
      case '/api/browser/tabs': {
        const browsers = getExtensionSummaries(state);
        const allTabs = browsers.flatMap((browser) => browser.tabs);
        const lastBrowser = browsers[browsers.length - 1];
        jsonResponse(res, 200, {
          status: 'success',
          protocolVersion: PROTOCOL_VERSION,
          browsers,
          tabs: allTabs,
          activeTabId: lastBrowser ? lastBrowser.activeTabId : null,
        }, req);
        break;
      }
      case '/api/browser/clients': {
        const browsers = getExtensionSummaries(state);
        jsonResponse(res, 200, {
          status: 'success',
          protocolVersion: PROTOCOL_VERSION,
          clients: browsers,
        }, req);
        break;
      }
      case '/api/browser/config':
        jsonResponse(res, 200, {
          status: 'success',
          config: {
            websocketAddress: `ws://${host}:${port}`,
            host,
            extensionPort: port,
            protocolVersion: PROTOCOL_VERSION,
            authRequired: Boolean(serverToken) && !security.allowAnonymous,
          },
        }, req);
        break;
      default:
        jsonResponse(res, 404, { status: 'error', message: 'Not found' }, req);
        break;
    }
  }

  const httpServer = http.createServer(handleHttpRequest);

  const wss = new WebSocketServer({
    server: httpServer,
    handleProtocols: (protocols) => {
      for (const p of protocols) {
        if (typeof p === 'string' && p.startsWith(WS_SUBPROTOCOL_PREFIX)) {
          return p;
        }
      }
      return false;
    },
    verifyClient: (info, cb) => {
      const origin = info.origin || (info.req && (info.req.headers.origin || info.req.headers.Origin));
      const access = checkAccess({
        token: serverToken,
        headers: info.req.headers,
        url: info.req.url,
        host: info.req.headers.host,
        origin,
        security,
        requireToken: Boolean(serverToken),
      });

      if (!access.allowed) {
        audit.write('ws.reject', {
          origin,
          url: info.req.url,
          reason: access.reason,
          remote: info.req.socket?.remoteAddress,
        });
        cb(false, 401, 'Unauthorized');
        return;
      }

      info.req._jsEyesAccess = access;
      if (access.anonymous) {
        logger.warn?.(`[js-eyes-server] anonymous WebSocket accepted origin=${origin || '<none>'} reason=${access.reason}`);
      }
      cb(true);
    },
  });

  wss.on('connection', (socket, request) => {
    const access = request._jsEyesAccess || { allowed: true, anonymous: false, reason: null };
    handleConnection(socket, request, state, { audit, access });
  });

  wss.on('error', (err) => {
    logger.error?.(`[js-eyes-server] wss error: ${err.message}`);
  });

  function start() {
    return new Promise((resolve, reject) => {
      cleanupTimer = startCleanup(state);

      httpServer.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${port} 已被占用`));
        } else {
          reject(err);
        }
      });

      httpServer.listen(port, host, () => {
        logger.info(`[js-eyes-server] WebSocket: ws://${host}:${port}`);
        logger.info(`[js-eyes-server] HTTP API:  http://${host}:${port}`);
        audit.write('server.start', {
          host,
          port,
          tokenRequired: Boolean(serverToken),
          allowAnonymous: Boolean(security.allowAnonymous),
        });
        resolve();
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      logger.info('[js-eyes-server] Shutting down...');
      audit.write('server.stop', { host, port });

      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }

      for (const [, conn] of state.extensionClients) {
        try { conn.socket.close(1000, 'Server shutting down'); } catch {}
      }
      for (const [, conn] of state.automationClients) {
        try { conn.socket.close(1000, 'Server shutting down'); } catch {}
      }
      for (const [, info] of state.pendingResponses) {
        clearTimeout(info.timeoutId);
      }

      const forceTimer = setTimeout(resolve, 3000);

      wss.close(() => {
        httpServer.close(() => {
          clearTimeout(forceTimer);
          audit.close?.();
          logger.info('[js-eyes-server] Server stopped.');
          resolve();
        });
      });
    });
  }

  return { start, stop, httpServer, wss, state, token: serverToken, tokenFilePath };
}

module.exports = {
  createServer,
  WS_CLOSE_CODE_AUTH_REQUIRED,
};

if (require.main === module) {
  const args = process.argv.slice(2);

  function getArg(name, fallback) {
    const index = args.indexOf(`--${name}`);
    return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
  }

  const port = parseInt(getArg('port', String(DEFAULT_SERVER_PORT)), 10);
  const host = getArg('host', DEFAULT_SERVER_HOST);
  const server = createServer({ port, host });

  server.start().then(() => {
    console.log('');
    console.log('=== js-eyes server ===');
    console.log(`WebSocket: ws://${host}:${port}`);
    console.log(`HTTP API:  http://${host}:${port}`);
    if (server.token) {
      console.log(`Auth token file: ${server.tokenFilePath || '(from options)'}`);
    }
    console.log(`Status:    http://${host}:${port}/api/browser/status`);
    console.log(`Tabs:      http://${host}:${port}/api/browser/tabs`);
    console.log('');
    console.log(`请在扩展 Popup 中将服务器地址设置为: ws://${host}:${port}`);
    console.log('');
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

  function shutdown() {
    server.stop().then(() => process.exit(0));
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
