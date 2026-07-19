'use strict';

const {
  createServer,
  ensureRuntimePaths,
  ensureToken,
  fs,
  getServerOptions,
  getTokenFilePath,
  isProcessAlive,
  loadConfig,
  path,
  print,
  readPid,
  readToken,
  resolveSecurityConfig,
  rotateToken,
  spawn,
} = require('../command-context');

async function runForegroundServer(flags) {
  const paths = ensureRuntimePaths();
  const config = loadConfig();
  const security = resolveSecurityConfig(config);
  const { host, port } = getServerOptions(flags, config);
  const server = createServer({
    host,
    port,
    logger: console,
    config,
    security,
    requestTimeout: config.requestTimeout,
    auditLogFile: paths.auditLogFile,
    pendingEgressDir: paths.pendingEgressDir,
  });

  /** @type {((exitCode?: number) => Promise<void>) & { done?: boolean }} */
  const cleanup = async (exitCode = 0) => {
    if (cleanup.done) {
      return;
    }
    cleanup.done = true;

    try {
      await server.stop();
    } catch {}

    const currentPid = readPid(paths);
    if (currentPid === process.pid && fs.existsSync(paths.pidFile)) {
      fs.rmSync(paths.pidFile, { force: true });
    }

    process.exit(exitCode);
  };

  await server.start();
  fs.writeFileSync(paths.pidFile, `${process.pid}\n`, 'utf8');

  print(`Server started on ws://${host}:${port}`);
  print(`HTTP API: http://${host}:${port}`);
  print(`PID: ${process.pid}`);
  print(`Log file: ${paths.serverLogFile}`);
  print(`Audit log: ${paths.auditLogFile}`);
  print(`Auth token file: ${paths.tokenFile}${server.token ? '' : ' (allowAnonymous)'}`);
  if (security.allowAnonymous) {
    print('!! WARNING: allowAnonymous=true — accepting unauthenticated connections.');
  }

  process.on('SIGINT', () => cleanup(0));
  process.on('SIGTERM', () => cleanup(0));

  return new Promise(() => {});
}

async function commandServer(positionals, flags) {
  const action = positionals[1];
  const paths = ensureRuntimePaths();
  const config = loadConfig();
  const { host, port } = getServerOptions(flags, config);

  switch (action) {
    case 'start': {
      if (flags.foreground) {
        await runForegroundServer(flags);
        return;
      }

      const existingPid = readPid(paths);
      if (existingPid && isProcessAlive(existingPid)) {
        print(`Server already running (PID ${existingPid})`);
        return;
      }

      const logFd = fs.openSync(paths.serverLogFile, 'a');
      const binPath = path.resolve(__dirname, '..', 'bin', 'js-eyes.js');
      const child = spawn(process.execPath, [
        binPath,
        'server',
        'start',
        '--foreground',
        '--host',
        host,
        '--port',
        String(port),
      ], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });

      child.unref();
      print(`Server start requested (PID ${child.pid})`);
      print(`Logs: ${paths.serverLogFile}`);
      return;
    }
    case 'stop': {
      const pid = readPid(paths);
      if (!pid) {
        print('Server is not running.');
        return;
      }

      if (!isProcessAlive(pid)) {
        fs.rmSync(paths.pidFile, { force: true });
        print(`Removed stale PID file (${pid}).`);
        return;
      }

      process.kill(pid, 'SIGTERM');
      print(`Sent SIGTERM to server PID ${pid}`);
      return;
    }
    case 'token': {
      const subaction = positionals[2] || 'show';
      switch (subaction) {
        case 'show': {
          const tk = readToken();
          if (!tk) {
            print('No server token found. It will be generated on next `js-eyes server start`.');
            print(`Token file: ${paths.tokenFile}`);
            return;
          }
          if (flags.reveal) {
            print(tk);
          } else {
            print(`Token (masked): ${tk.slice(0, 8)}...${tk.slice(-4)}`);
            print('Re-run with --reveal to print the full token.');
          }
          print(`Token file: ${getTokenFilePath()}`);
          return;
        }
        case 'init': {
          const result = ensureToken();
          print(result.created ? 'Generated new token.' : 'Token already exists.');
          print(`Token file: ${result.path}`);
          return;
        }
        case 'rotate': {
          const result = rotateToken();
          print('Token rotated. Restart the server and reconfigure clients.');
          print(`Token file: ${result.path}`);
          if (flags.reveal) print(result.token);
          return;
        }
        default:
          throw new Error('用法: `js-eyes server token [show|init|rotate] [--reveal]`');
      }
    }
    default:
      throw new Error('支持的命令: `js-eyes server start [--foreground]` / `js-eyes server stop` / `js-eyes server token [show|init|rotate]`');
  }
}

module.exports = { commandServer };
