'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createServer } = require('@js-eyes/server-core');
const { loadConfig, getConfigValue, parseConfigValue, setConfigValue } = require('@js-eyes/config');
const {
  chmodBestEffort,
  ensureRuntimePaths,
  ensureSecretFilePermissions,
  getPaths,
  resolveSkillRecordsDir,
} = require('@js-eyes/runtime-paths');
const {
  ensureToken,
  readToken,
  rotateToken,
  getTokenFilePath,
} = require('@js-eyes/runtime-paths/token');
const {
  COMPATIBILITY_MATRIX,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  POLICY_ENFORCEMENT_LEVELS,
  PROTOCOL_VERSION,
  RELEASE_BASE_URL,
  isLoopbackHost,
  resolveSecurityConfig,
} = require('@js-eyes/protocol');
const {
  ALL_BROWSERS: NATIVE_HOST_ALL_BROWSERS,
  NATIVE_HOST_NAME,
  installBrowsers: installNativeHostBrowsers,
  resolveHostScriptPath: resolveNativeHostScript,
  statusBrowsers: statusNativeHostBrowsers,
  uninstallBrowsers: uninstallNativeHostBrowsers,
} = require('@js-eyes/native-host');
const {
  applySkillInstall,
  discoverLocalSkills,
  discoverSkillsFromSources,
  fetchSkillsRegistry,
  getLegacyOpenClawSkillState,
  installSkillFromRegistry,
  isSkillEnabled,
  planSkillInstall,
  readSkillById,
  readSkillByIdFromSources,
  readSkillIntegrity,
  resolveSkillSources,
  resolveSkillsDir,
  runSkillCli,
  verifySkillIntegrity,
} = require('@js-eyes/protocol/skills');

function resolveSources(paths, config) {
  return resolveSkillSources({
    primary: resolveSkillsDir(paths, config),
    extras: Array.isArray(config && config.extraSkillDirs) ? config.extraSkillDirs : [],
  });
}
const pkg = require('../package.json');

function print(message = '') {
  process.stdout.write(String(message) + '\n');
}

function parseArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }

  return { positionals, flags };
}

function getServerOptions(flags, config) {
  return {
    host: flags.host || config.serverHost || DEFAULT_SERVER_HOST,
    port: Number(flags.port || config.serverPort || DEFAULT_SERVER_PORT),
  };
}

function getLoopbackOrigin(host) {
  if (!isLoopbackHost(host)) {
    return null;
  }
  if (host === '::1' || host === '[::1]') {
    return 'http://[::1]';
  }
  return `http://${host}`;
}

function isProcessAlive(pid) {
  if (!pid || Number.isNaN(Number(pid))) {
    return false;
  }

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(paths) {
  if (!fs.existsSync(paths.pidFile)) {
    return null;
  }

  const raw = fs.readFileSync(paths.pidFile, 'utf8').trim();
  const pid = Number(raw);
  return Number.isNaN(pid) ? null : pid;
}

async function fetchJson(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (!headers.Origin && options.host) {
    const origin = getLoopbackOrigin(options.host);
    if (origin) {
      headers.Origin = origin;
    }
  }
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function readServerToken() {
  if (process.env.JS_EYES_SERVER_TOKEN) return process.env.JS_EYES_SERVER_TOKEN;
  return readToken();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolvePluginPath() {
  const configuredPath = process.env.JS_EYES_PLUGIN_DIR
    ? path.resolve(process.env.JS_EYES_PLUGIN_DIR)
    : null;
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const candidates = [
    configuredPath,
    path.join(repoRoot, 'openclaw-plugin'),
    path.join(process.cwd(), 'openclaw-plugin'),
  ].filter(Boolean);

  const pluginDir = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'openclaw.plugin.json')));
  if (!pluginDir) {
    throw new Error('未找到 `openclaw-plugin` 组件目录');
  }
  return pluginDir;
}

function flagsToArgv(flags) {
  const argv = [];
  for (const [key, value] of Object.entries(flags)) {
    argv.push(`--${key}`);
    if (value !== true) {
      argv.push(String(value));
    }
  }
  return argv;
}

function readPackageVersion(specifier) {
  try {
    return require(`${specifier}/package.json`).version;
  } catch {
    return 'unknown';
  }
}

function readPluginVersion() {
  try {
    return readJson(path.join(resolvePluginPath(), 'package.json')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getLocalVersions() {
  return {
    cli: pkg.version,
    protocol: readPackageVersion('@js-eyes/protocol'),
    config: readPackageVersion('@js-eyes/config'),
    runtimePaths: readPackageVersion('@js-eyes/runtime-paths'),
    serverCore: readPackageVersion('@js-eyes/server-core'),
    openclawPlugin: readPluginVersion(),
  };
}

function getCompatibilityReport(serverPayload) {
  const versions = getLocalVersions();
  const serverProtocolVersion = serverPayload?.data?.protocolVersion || null;
  const serverVersion = serverPayload?.data?.serverVersion || null;
  const serverStatus = !serverPayload
    ? 'unreachable'
    : (serverProtocolVersion === PROTOCOL_VERSION ? 'ok' : 'mismatch');

  return {
    versions,
    matrix: COMPATIBILITY_MATRIX,
    serverStatus,
    serverProtocolVersion,
    serverVersion,
  };
}

function resolveExtensionAsset(browser, version = pkg.version) {
  if (browser !== 'chrome' && browser !== 'firefox') {
    throw new Error(`不支持的扩展类型: ${browser}`);
  }

  const filename = browser === 'chrome'
    ? `js-eyes-chrome-v${version}.zip`
    : `js-eyes-firefox-v${version}.xpi`;

  return {
    browser,
    version,
    filename,
    url: `${RELEASE_BASE_URL}/v${version}/${filename}`,
  };
}

async function commandStatus(flags) {
  const config = loadConfig();
  const { host, port } = getServerOptions(flags, config);
  const endpoint = `http://${host}:${port}/api/browser/status`;
  const paths = getPaths();
  const pid = readPid(paths);
  const token = readServerToken();

  try {
    const payload = await fetchJson(endpoint, { token, host });
    const data = payload.data || {};
    print(`Server: reachable (${endpoint})`);
    print(`PID file: ${pid || 'none'}`);
    print(`Protocol: ${data.protocolVersion || PROTOCOL_VERSION}`);
    print(`Server version: ${data.serverVersion || 'unknown'}`);
    print(`Uptime: ${data.uptime || 0}s`);
    print(`Extensions: ${data.connections?.extensions?.length || 0}`);
    print(`Automation clients: ${data.connections?.automationClients || 0}`);
    print(`Tabs: ${data.tabs || 0}`);
  } catch (error) {
    print(`Server: unreachable (${endpoint})`);
    print(`PID file: ${pid || 'none'}`);
    if (pid && !isProcessAlive(pid)) {
      print('发现陈旧 PID 文件，可执行 `js-eyes server stop` 清理。');
    }
    throw new Error(`状态检查失败: ${error.message}`);
  }
}

function checkFilePermissions(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false };
  try {
    const stat = fs.statSync(filePath);
    const mode = stat.mode & 0o777;
    return { exists: true, mode, secure: mode === 0o600 || mode === 0o400 };
  } catch (error) {
    return { exists: true, error: error.message };
  }
}

async function commandDoctor(flags) {
  const paths = ensureRuntimePaths();
  const config = loadConfig();
  const security = resolveSecurityConfig(config);
  const { host, port } = getServerOptions(flags, config);
  const endpoint = `http://${host}:${port}/api/browser/status`;
  const pid = readPid(paths);
  const token = readServerToken();
  const sources = resolveSources(paths, config);
  const skillsDir = sources.primary;

  print(`JS Eyes CLI ${pkg.version}`);
  print(`Config file: ${paths.configFile}`);
  print(`Runtime dir: ${paths.runtimeDir}`);
  print(`Token file: ${paths.tokenFile}${token ? '' : ' (missing)'}`);
  print(`Audit log: ${paths.auditLogFile}`);
  print(`Log file: ${paths.serverLogFile}`);
  print(`Downloads dir: ${paths.downloadsDir}`);
  print(`Primary skills dir: ${skillsDir}`);
  if (sources.extras.length > 0) {
    print(`Extra skill dirs:`);
    for (const extra of sources.extras) {
      const extraSkills = discoverSkillsFromSources({ primary: '', extras: [extra] }).skills;
      print(`  - ${extra.path} (${extra.kind}, ${extraSkills.length} skill${extraSkills.length === 1 ? '' : 's'})`);
    }
  }
  for (const invalid of sources.invalid || []) {
    print(`Extra skill dir IGNORED: ${invalid.path} (${invalid.reason})`);
  }
  print(`Skill records dir: ${resolveSkillRecordsDir({ recordingBaseDir: config.recording?.baseDir })}`);
  try {
    print(`OpenClaw plugin: ${resolvePluginPath()}`);
  } catch (error) {
    print(`OpenClaw plugin: unavailable (${error.message})`);
  }
  print(`Configured server: ${endpoint}`);
  print(`Stored PID: ${pid || 'none'}`);
  print(`PID alive: ${pid ? (isProcessAlive(pid) ? 'yes' : 'no') : 'n/a'}`);
  print(`Recording mode: ${config.recording?.mode || 'standard'}`);

  print('');
  print('Security checks:');
  print(`  allowAnonymous: ${security.allowAnonymous ? 'YES (insecure)' : 'no'}`);
  print(`  host loopback: ${isLoopbackHost(host) ? 'yes' : 'NO (binds to non-loopback)'}`);
  print(`  allowRawEval: ${security.allowRawEval ? 'YES (insecure)' : 'no'}`);
  print(`  requireLockfile: ${security.requireLockfile ? 'yes' : 'NO'}`);
  print(`  allowedOrigins: ${(security.allowedOrigins || []).join(', ') || '(none)'}`);
  print(`  registry url: ${config.skillsRegistryUrl}${config.skillsRegistryUrl?.includes('js-eyes.com') ? '' : ' (custom — please verify)'}`);

  print('');
  print('Policy engine (2.3):');
  print(`  enforcement: ${security.enforcement}${security.enforcement === 'off' ? ' (audit only)' : ''}`);
  print(`  taskOrigin.enabled: ${security.taskOrigin?.enabled ? 'yes' : 'no'}`);
  print(`  taskOrigin.sources: ${(security.taskOrigin?.sources || []).join(', ') || '(none)'}`);
  print(`  taint.enabled: ${security.taint?.enabled ? 'yes' : 'no'} (mode=${security.taint?.mode || 'n/a'})`);
  print(`  egressAllowlist: ${(security.egressAllowlist || []).join(', ') || '(empty)'}`);

  const pendingDir = paths.pendingEgressDir;
  let pendingCount = 0;
  if (fs.existsSync(pendingDir)) {
    pendingCount = fs.readdirSync(pendingDir).filter((n) => n.endsWith('.json')).length;
  }
  const backlogTag = pendingCount >= 10 ? ' WARN (backlog)' : '';
  print(`  pending-egress: ${pendingCount} at ${pendingDir}${backlogTag}`);

  try {
    if (!fs.existsSync(paths.auditLogFile)) {
      print('  soft-block last: (audit log not yet created)');
    } else {
      const raw = fs.readFileSync(paths.auditLogFile, 'utf8').split('\n').filter(Boolean);
      const recent = raw.slice(-500).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      const softBlocks = recent.filter((r) => r && (r.event === 'policy.soft-block' || r.event === 'automation.soft-block' || r.rule_decision === 'soft-block'));
      if (softBlocks.length > 0) {
        const latest = softBlocks[softBlocks.length - 1];
        print(`  soft-block last: ${latest.ts} tool=${latest.tool || latest.action || 'n/a'} rule=${latest.rule || 'n/a'}`);
        const counts = new Map();
        for (const r of softBlocks) {
          const k = `${r.tool || r.action || 'n/a'}::${r.rule || (Array.isArray(r.reasons) ? r.reasons[0]?.rule : 'n/a')}`;
          counts.set(k, (counts.get(k) || 0) + 1);
        }
        const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
        print(`  soft-block top3: ${top.map(([k, v]) => `${k} x${v}`).join(' | ') || '(none)'}`);
      } else {
        print('  soft-block last: (none recently)');
      }
    }
  } catch (error) {
    print(`  soft-block stats: error (${error.message})`);
  }

  try {
    const wildcardSkills = [];
    const unknownSkills = [];
    if (fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillId = entry.name;
        const skillDir = path.join(skillsDir, skillId);
        const contractPath = path.join(skillDir, 'skill.contract.js');
        if (!fs.existsSync(contractPath)) continue;
        try {
          const raw = fs.readFileSync(contractPath, 'utf8');
          const platformsMatch = raw.match(/platforms\s*:\s*\[([^\]]*)\]/);
          if (!platformsMatch) {
            unknownSkills.push(skillId);
            continue;
          }
          const items = platformsMatch[1]
            .split(',')
            .map((s) => s.trim().replace(/^['"`]|['"`]$/g, ''))
            .filter(Boolean);
          if (items.length === 0 || items.includes('*')) {
            wildcardSkills.push(skillId);
          }
        } catch {
          unknownSkills.push(skillId);
        }
      }
    }
    if (wildcardSkills.length > 0) {
      print(`  skills with platforms=['*']: ${wildcardSkills.join(', ')} (weakest protection)`);
    } else {
      print('  skills with platforms=[\'*\']: (none)');
    }
    if (unknownSkills.length > 0) {
      print(`  skills platforms unknown: ${unknownSkills.join(', ')}`);
    }
  } catch (error) {
    print(`  skill platforms check: skipped (${error.message})`);
  }

  print('');
  print('File permissions (POSIX only, target = 600):');
  for (const target of [paths.configFile, paths.tokenFile, paths.auditLogFile]) {
    const status = checkFilePermissions(target);
    if (!status.exists) {
      print(`  ${target}: missing`);
    } else if (status.error) {
      print(`  ${target}: error (${status.error})`);
    } else {
      print(`  ${target}: ${status.mode.toString(8).padStart(3, '0')} ${status.secure ? 'OK' : 'WARN'}`);
    }
  }

  print('');
  print('Skill integrity:');
  const skillDirs = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ id: entry.name, dir: path.join(skillsDir, entry.name) }))
    : [];
  if (skillDirs.length === 0) {
    print('  (no installed skills)');
  } else {
    for (const { id, dir } of skillDirs) {
      try {
        const result = verifySkillIntegrity(dir);
        if (!result.hasIntegrity) {
          print(`  ${id}: NO integrity manifest (skill installed before pinning)`);
        } else if (result.ok) {
          print(`  ${id}: OK (${result.checked} files)`);
        } else {
          print(`  ${id}: FAIL — ${result.mismatches.length} mismatched / ${result.missing.length} missing`);
        }
      } catch (error) {
        print(`  ${id}: ERROR (${error.message})`);
      }
    }
  }

  const localVersions = getLocalVersions();
  print('');
  print('Local package versions:');
  print(`  cli=${localVersions.cli}`);
  print(`  protocol=${localVersions.protocol}`);
  print(`  config=${localVersions.config}`);
  print(`  runtime-paths=${localVersions.runtimePaths}`);
  print(`  server-core=${localVersions.serverCore}`);
  print(`  openclaw-plugin=${localVersions.openclawPlugin}`);
  print('');
  print('Compatibility matrix:');
  print(`  protocolVersion=${COMPATIBILITY_MATRIX.protocolVersion}`);
  print(`  cli=${COMPATIBILITY_MATRIX.cliVersion}`);
  print(`  extension=${COMPATIBILITY_MATRIX.extensionVersion}`);
  print(`  server-core=${COMPATIBILITY_MATRIX.serverCoreVersion}`);
  print(`  client-sdk=${COMPATIBILITY_MATRIX.clientSdkVersion}`);
  print(`  openclaw-plugin=${COMPATIBILITY_MATRIX.openclawPluginVersion}`);
  print(`  skills(client-sdk)=${COMPATIBILITY_MATRIX.skillClientSdkVersion}`);

  print('');
  print('Native messaging host:');
  try {
    const nmResults = statusNativeHostBrowsers('all');
    print(`  host script: ${resolveNativeHostScript()}`);
    for (const item of nmResults) {
      const flag = item.installed ? 'installed' : 'missing';
      const launcher = item.launcherExists ? 'ok' : 'missing';
      print(`  ${item.browser}: ${flag} (launcher ${launcher})`);
    }
  } catch (error) {
    print(`  status error: ${error.message}`);
  }

  try {
    const payload = await fetchJson(endpoint, { token, host });
    print(`Server health: ok (${payload.status || 'success'})`);
    const compatibility = getCompatibilityReport(payload);
    print(`Server protocol: ${compatibility.serverProtocolVersion || 'unknown'}`);
    print(`Server version: ${compatibility.serverVersion || 'unknown'}`);
    print(`Compatibility: ${compatibility.serverStatus}`);
  } catch (error) {
    print(`Server health: failed (${error.message})`);
    print('Compatibility: unreachable');
  }
}

async function commandConfig(positionals) {
  const action = positionals[1];
  const key = positionals[2];

  switch (action) {
    case 'get': {
      const value = getConfigValue(key);
      if (key) {
        print(value === undefined ? 'undefined' : JSON.stringify(value, null, 2));
      } else {
        print(JSON.stringify(value, null, 2));
      }
      return;
    }
    case 'set': {
      if (!key || positionals[3] === undefined) {
        throw new Error('用法: js-eyes config set <key> <value>');
      }
      const value = parseConfigValue(positionals[3]);
      const nextConfig = setConfigValue(key, value);
      print(JSON.stringify(nextConfig, null, 2));
      return;
    }
    default:
      throw new Error('支持的命令: `js-eyes config get [key]` / `js-eyes config set <key> <value>`');
  }
}

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

async function commandAudit(positionals, flags) {
  const action = positionals[1];
  const paths = ensureRuntimePaths();
  if (action !== 'tail') {
    throw new Error('用法: `js-eyes audit tail [--lines 100] [--since <iso>]`');
  }
  if (!fs.existsSync(paths.auditLogFile)) {
    print(`No audit log yet at ${paths.auditLogFile}`);
    return;
  }
  const limit = Number(flags.lines || 100);
  const since = flags.since ? new Date(flags.since).getTime() : null;
  const raw = fs.readFileSync(paths.auditLogFile, 'utf8').split('\n').filter(Boolean);
  let rows = raw.slice(-Math.max(limit * 4, limit)).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  if (since !== null && !Number.isNaN(since)) {
    rows = rows.filter((r) => new Date(r.ts || 0).getTime() >= since);
  }
  rows = rows.slice(-limit);
  for (const row of rows) {
    print(JSON.stringify(row));
  }
}

async function commandConsent(positionals) {
  const action = positionals[1];
  const id = positionals[2];
  const paths = ensureRuntimePaths();
  const consentsDir = paths.consentsDir;
  if (!fs.existsSync(consentsDir)) {
    print(`No pending consents at ${consentsDir}`);
    return;
  }

  function listPending() {
    return fs.readdirSync(consentsDir).filter((name) => name.endsWith('.json')).map((name) => {
      const filePath = path.join(consentsDir, name);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { id: name.replace(/\.json$/, ''), filePath, data };
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  switch (action) {
    case 'list': {
      const items = listPending();
      if (items.length === 0) {
        print('No pending consent requests.');
        return;
      }
      for (const item of items) {
        const status = item.data.status || 'pending';
        print(`- ${item.id} [${status}] tool=${item.data.toolName || 'n/a'} requestedAt=${item.data.requestedAt || 'n/a'}`);
        if (item.data.summary) print(`    ${item.data.summary}`);
      }
      return;
    }
    case 'approve':
    case 'deny': {
      if (!id) throw new Error(`用法: \`js-eyes consent ${action} <id>\``);
      const filePath = path.join(consentsDir, `${id}.json`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Consent ${id} not found.`);
      }
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      data.status = action === 'approve' ? 'approved' : 'denied';
      data.decidedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
      chmodBestEffort(filePath, 0o600);
      print(`Consent ${id} ${data.status}.`);
      return;
    }
    default:
      throw new Error('用法: `js-eyes consent list|approve <id>|deny <id>`');
  }
}

async function commandEgress(positionals, flags) {
  const action = positionals[1];
  const paths = ensureRuntimePaths();
  const dir = paths.pendingEgressDir;

  function listPending() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const file = path.join(dir, name);
        try {
          const data = JSON.parse(fs.readFileSync(file, 'utf8'));
          return { id: name.replace(/\.json$/, ''), file, data };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  switch (action) {
    case 'list': {
      const items = listPending();
      if (items.length === 0) {
        print(`No pending egress at ${dir}`);
        return;
      }
      print(`Pending egress (${items.length}) at ${dir}`);
      for (const item of items) {
        const host = item.data.host || item.data.params?.url || 'unknown';
        print(`- ${item.id} host=${host} tool=${item.data.tool || 'n/a'} ts=${item.data.ts || 'n/a'}`);
        if (item.data.reason) print(`    reason: ${item.data.reason}`);
      }
      return;
    }
    case 'approve': {
      const id = positionals[2];
      if (!id) throw new Error('用法: `js-eyes egress approve <id>`');
      const file = path.join(dir, `${id}.json`);
      if (!fs.existsSync(file)) throw new Error(`Egress request ${id} not found.`);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const host = data.host;
      if (!host) throw new Error(`Egress request ${id} has no host field.`);
      const sessionFile = path.join(dir, '.session-allowlist.json');
      let session = [];
      if (fs.existsSync(sessionFile)) {
        try { session = JSON.parse(fs.readFileSync(sessionFile, 'utf8')); } catch {}
      }
      if (!Array.isArray(session)) session = [];
      if (!session.includes(host)) session.push(host);
      fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2) + '\n');
      chmodBestEffort(sessionFile, 0o600);
      fs.rmSync(file, { force: true });
      print(`Approved egress ${id} -> ${host} (session allowlist).`);
      print('Note: session-level approvals do not auto-execute the original call; agent needs to re-invoke it.');
      return;
    }
    case 'allow': {
      const domain = positionals[2];
      if (!domain) throw new Error('用法: `js-eyes egress allow <domain>`');
      const config = loadConfig();
      const security = config.security || {};
      const current = Array.isArray(security.egressAllowlist) ? security.egressAllowlist.slice() : [];
      if (!current.includes(domain)) current.push(domain);
      const nextConfig = setConfigValue('security.egressAllowlist', current);
      print(`Added ${domain} to security.egressAllowlist.`);
      print(`Current allowlist: ${(nextConfig.security?.egressAllowlist || []).join(', ') || '(empty)'}`);
      return;
    }
    case 'clear': {
      const items = listPending();
      let removed = 0;
      for (const item of items) {
        try { fs.rmSync(item.file, { force: true }); removed++; } catch {}
      }
      print(`Cleared ${removed} pending egress record(s).`);
      return;
    }
    default:
      throw new Error('支持的命令: `js-eyes egress list` / `approve <id>` / `allow <domain>` / `clear`');
  }
}

async function commandSecurity(positionals, flags) {
  const action = positionals[1];

  switch (action) {
    case 'show': {
      const config = loadConfig();
      const security = resolveSecurityConfig(config);
      print(JSON.stringify({
        enforcement: security.enforcement,
        taskOrigin: security.taskOrigin,
        egressAllowlist: security.egressAllowlist,
        taint: security.taint,
        profile: security.profile,
        allowAnonymous: security.allowAnonymous,
        allowRawEval: security.allowRawEval,
        requireLockfile: security.requireLockfile,
      }, null, 2));
      return;
    }
    case 'enforce': {
      const level = positionals[2];
      if (!level || !POLICY_ENFORCEMENT_LEVELS.includes(level)) {
        throw new Error(`用法: \`js-eyes security enforce <${POLICY_ENFORCEMENT_LEVELS.join('|')}>\``);
      }
      const nextConfig = setConfigValue('security.enforcement', level);
      print(`security.enforcement = ${nextConfig.security?.enforcement}`);
      if (level === 'off') print('!! Policy rules will only audit, not block.');
      if (level === 'strict') print('!! Policy rules will reject violating calls (breaks existing workflows if task origin is not declared).');
      return;
    }
    default:
      throw new Error('支持的命令: `js-eyes security show` / `enforce <off|soft|strict>`');
  }
}

async function commandOpenClaw(positionals) {
  const action = positionals[1];

  if (action !== 'plugin-path') {
    throw new Error('支持的命令: `js-eyes openclaw plugin-path`');
  }

  print(resolvePluginPath());
}

async function commandExtension(positionals, flags) {
  const action = positionals[1];
  const browser = positionals[2];

  if (action !== 'download' || !browser) {
    throw new Error('用法: `js-eyes extension download <chrome|firefox> [--output /path/file]`');
  }

  const paths = ensureRuntimePaths();
  const asset = resolveExtensionAsset(browser);
  const outputPath = flags.output
    ? path.resolve(flags.output)
    : path.join(paths.downloadsDir, asset.filename);

  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status} (${asset.url})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  print(`Downloaded ${browser} extension`);
  print(`Version: ${asset.version}`);
  print(`Source: ${asset.url}`);
  print(`Saved to: ${outputPath}`);
}

async function commandSkills(positionals, flags) {
  const action = positionals[1];
  const skillId = positionals[2];
  const paths = ensureRuntimePaths();
  const config = loadConfig();
  const sources = resolveSources(paths, config);
  const skillsDir = sources.primary;

  switch (action) {
    case 'list': {
      const { skills: installed, conflicts } = discoverSkillsFromSources(sources);
      const installedMap = new Map(installed.map((skill) => [skill.id, skill]));
      const legacyState = getLegacyOpenClawSkillState({
        skillIds: installed.map((skill) => skill.id),
      });
      const registryUrl = flags.registry || config.skillsRegistryUrl;

      const wantJson = Boolean(flags.json);
      let registry = null;
      let registryError = null;
      try {
        registry = await fetchSkillsRegistry(registryUrl);
      } catch (error) {
        registryError = error;
        if (!wantJson && installed.length === 0) {
          throw new Error(`无法读取技能注册表: ${error.message}`);
        }
      }

      if (wantJson) {
        const extrasSummary = sources.extras.map((extra) => ({
          path: extra.path,
          kind: extra.kind,
          count: installed.filter((s) => s.source === 'extra' && s.sourcePath === extra.path).length,
        }));
        const payload = {
          primary: sources.primary,
          extras: extrasSummary,
          invalid: sources.invalid || [],
          registry: registry ? { url: registryUrl, skills: registry.skills || [] } : null,
          registryError: registryError ? registryError.message : null,
          conflicts,
          skills: installed.map((skill) => ({
            id: skill.id,
            name: skill.name,
            version: skill.version,
            description: skill.description,
            source: skill.source,
            sourcePath: skill.sourcePath,
            skillDir: skill.skillDir,
            tools: skill.tools,
            commands: skill.commands,
            enabled: isSkillEnabled(config, skill.id, legacyState),
          })),
        };
        print(JSON.stringify(payload, null, 2));
        return;
      }

      const renderSourceLine = (skill) =>
        skill.source === 'primary'
          ? '  Source: primary'
          : `  Source: extra (${skill.sourcePath})`;

      if (registry) {
        const lines = [
          `Registry: ${registryUrl}`,
          `Primary skills dir: ${skillsDir}`,
        ];
        if (sources.extras.length > 0) {
          lines.push(`Extra skill dirs: ${sources.extras.length}`);
          for (const extra of sources.extras) {
            lines.push(`  - ${extra.path} (${extra.kind})`);
          }
        }
        lines.push('');

        for (const skill of registry.skills || []) {
          const local = installedMap.get(skill.id);
          lines.push(`- ${skill.id} ${local ? '[installed]' : '[available]'}`);
          lines.push(`  ${skill.description || ''}`);
          if (Array.isArray(skill.commands) && skill.commands.length > 0) {
            lines.push(`  Commands: ${skill.commands.join(', ')}`);
          }
          if (Array.isArray(skill.tools) && skill.tools.length > 0) {
            lines.push(`  Tools: ${skill.tools.join(', ')}`);
          }
          if (local) {
            lines.push(`  Enabled: ${isSkillEnabled(config, skill.id, legacyState) ? 'yes' : 'no'}`);
            lines.push(`  Installed at: ${local.skillDir}`);
            lines.push(renderSourceLine(local));
          }
          lines.push('');
        }

        const extraOnly = installed.filter((s) => s.source === 'extra' && !(registry.skills || []).some((rs) => rs.id === s.id));
        if (extraOnly.length > 0) {
          lines.push(`Extra-only skills (not in registry):`);
          for (const skill of extraOnly) {
            lines.push(`- ${skill.id} [installed]`);
            lines.push(`  ${skill.description || ''}`);
            if (skill.commands.length > 0) lines.push(`  Commands: ${skill.commands.join(', ')}`);
            if (skill.tools.length > 0) lines.push(`  Tools: ${skill.tools.join(', ')}`);
            lines.push(`  Enabled: ${isSkillEnabled(config, skill.id, legacyState) ? 'yes' : 'no'}`);
            lines.push(`  Installed at: ${skill.skillDir}`);
            lines.push(renderSourceLine(skill));
            lines.push('');
          }
        }

        if (conflicts.length > 0) {
          lines.push(`Conflicts (primary-wins):`);
          for (const c of conflicts) {
            lines.push(`  - ${c.id}: kept ${c.winner.source} ${c.winner.path}, skipped ${c.loser.source} ${c.loser.path}`);
          }
        }

        print(lines.join('\n').trimEnd());
        return;
      }

      const lines = [
        `Registry unavailable: ${registryError ? registryError.message : 'unknown error'}`,
        `Primary skills dir: ${skillsDir}`,
      ];
      if (sources.extras.length > 0) {
        lines.push(`Extra skill dirs: ${sources.extras.length}`);
        for (const extra of sources.extras) {
          lines.push(`  - ${extra.path} (${extra.kind})`);
        }
      }
      lines.push('');
      for (const skill of installed) {
        lines.push(`- ${skill.id} [installed]`);
        lines.push(`  ${skill.description || ''}`);
        if (skill.commands.length > 0) {
          lines.push(`  Commands: ${skill.commands.join(', ')}`);
        }
        if (skill.tools.length > 0) {
          lines.push(`  Tools: ${skill.tools.join(', ')}`);
        }
        lines.push(`  Enabled: ${isSkillEnabled(config, skill.id, legacyState) ? 'yes' : 'no'}`);
        lines.push(`  Installed at: ${skill.skillDir}`);
        lines.push(renderSourceLine(skill));
        lines.push('');
      }
      if (conflicts.length > 0) {
        lines.push(`Conflicts (primary-wins):`);
        for (const c of conflicts) {
          lines.push(`  - ${c.id}: kept ${c.winner.source} ${c.winner.path}, skipped ${c.loser.source} ${c.loser.path}`);
        }
      }
      print(lines.join('\n').trimEnd());
      return;
    }
    case 'install': {
      if (!skillId) {
        throw new Error('用法: `js-eyes skills install <skillId> [--force] [--plan] [--allow-postinstall]`');
      }

      const existing = readSkillByIdFromSources({
        id: skillId,
        primary: skillsDir,
        extras: sources.extras,
      });
      if (existing && existing.source === 'extra') {
        throw new Error(
          `技能 "${skillId}" 来自外部源 ${existing.sourcePath}，js-eyes 不接管其生命周期（install/uninstall 仅作用于 primary）。请直接维护该目录下的项目。`,
        );
      }

      const security = resolveSecurityConfig(config);
      const planOnly = Boolean(flags.plan);

      const planResult = await planSkillInstall({
        skillId,
        registryUrl: flags.registry || config.skillsRegistryUrl,
        skillsDir,
        force: Boolean(flags.force),
        logger: console,
      });
      const plan = planResult.plan;

      print(`Skill: ${planResult.skill.name || skillId}`);
      print(`Source: ${plan.sourceUrl}`);
      print(`SHA-256: ${plan.bundleSha256}`);
      print(`Bundle size: ${plan.bundleSize} bytes`);
      print(`Declared tools: ${(plan.declaredTools || []).join(', ') || '(none)'}`);
      print(`Has package-lock.json: ${plan.hasLockfile ? 'yes' : 'no'}`);
      print(`Files in bundle: ${plan.stagedFiles.length}`);
      print(`Target dir: ${plan.targetDir}`);
      print(`Staging dir: ${plan.stagingDir}`);

      if (planOnly) {
        const planFile = path.join(paths.runtimeDir, 'pending-skills', `${skillId}.json`);
        fs.mkdirSync(path.dirname(planFile), { recursive: true });
        fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + '\n');
        chmodBestEffort(planFile, 0o600);
        print('');
        print(`Plan written to ${planFile}`);
        print(`Run \`js-eyes skills approve ${skillId}\` to apply.`);
        return;
      }

      const apply = applySkillInstall(plan, {
        requireLockfile: security.requireLockfile,
        allowPostinstall: Boolean(flags['allow-postinstall']),
      });
      setConfigValue(`skillsEnabled.${skillId}`, true);

      print('');
      print('Installed.');
      print(`Location: ${apply.targetDir}`);
      print('Enabled in JS Eyes host config: yes');
      print('Integrity manifest written: .integrity.json');
      print('Restart OpenClaw or start a new session to load the new skill tools.');
      return;
    }
    case 'approve': {
      if (!skillId) {
        throw new Error('用法: `js-eyes skills approve <skillId>`');
      }
      const existingApprove = readSkillByIdFromSources({
        id: skillId,
        primary: skillsDir,
        extras: sources.extras,
      });
      if (existingApprove && existingApprove.source === 'extra') {
        throw new Error(
          `技能 "${skillId}" 来自外部源 ${existingApprove.sourcePath}，js-eyes 不接管其生命周期（install/approve/uninstall 仅作用于 primary）。`,
        );
      }
      const planFile = path.join(paths.runtimeDir, 'pending-skills', `${skillId}.json`);
      if (!fs.existsSync(planFile)) {
        throw new Error(`No pending plan for ${skillId}. Run \`js-eyes skills install ${skillId} --plan\` first.`);
      }
      const security = resolveSecurityConfig(config);
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      const apply = applySkillInstall(plan, {
        requireLockfile: security.requireLockfile,
        allowPostinstall: Boolean(flags['allow-postinstall']),
      });
      setConfigValue(`skillsEnabled.${skillId}`, true);
      fs.rmSync(planFile, { force: true });
      print(`Approved and installed ${skillId} at ${apply.targetDir}`);
      return;
    }
    case 'verify': {
      const targets = skillId ? [skillId] : discoverLocalSkills(skillsDir).map((s) => s.id);
      let failed = 0;
      for (const id of targets) {
        const skill = readSkillById(skillsDir, id);
        if (!skill) {
          const external = readSkillByIdFromSources({
            id,
            primary: skillsDir,
            extras: sources.extras,
          });
          if (external && external.source === 'extra') {
            print(`- ${id}: SKIPPED (extra source ${external.sourcePath}, no integrity check)`);
            continue;
          }
          print(`- ${id}: NOT INSTALLED`);
          failed++;
          continue;
        }
        const result = verifySkillIntegrity(skill.skillDir);
        if (!result.hasIntegrity) {
          print(`- ${id}: NO integrity manifest`);
          failed++;
          continue;
        }
        if (result.ok) {
          print(`- ${id}: OK (${result.checked} files)`);
        } else {
          print(`- ${id}: FAIL (${result.mismatches.length} mismatched, ${result.missing.length} missing)`);
          for (const m of result.mismatches) print(`    mismatch: ${m}`);
          for (const m of result.missing) print(`    missing: ${m}`);
          failed++;
        }
      }
      if (failed > 0) {
        process.exitCode = 2;
      }
      return;
    }
    case 'enable':
    case 'disable': {
      if (!skillId) {
        throw new Error(`用法: \`js-eyes skills ${action} <skillId>\``);
      }
      const skill = readSkillByIdFromSources({
        id: skillId,
        primary: skillsDir,
        extras: sources.extras,
      });
      if (!skill) {
        throw new Error(
          `技能未找到: ${skillId}（已在 primary 和 ${sources.extras.length} 个 extra 源中搜索）`,
        );
      }

      const enabledValue = action === 'enable';
      setConfigValue(`skillsEnabled.${skillId}`, enabledValue);

      print(`${enabledValue ? 'Enabled' : 'Disabled'} skill: ${skillId}`);
      if (skill.source === 'extra') {
        print(`Source: extra (${skill.sourcePath})`);
      }
      print('OpenClaw child plugin config updated: no (main js-eyes plugin reads JS Eyes host config)');
      print('Restart OpenClaw or start a new session for the change to take effect.');
      return;
    }
    default:
      throw new Error('支持的命令: `js-eyes skills list` / `install <skillId> [--plan]` / `approve <skillId>` / `verify [skillId]` / `enable <skillId>` / `disable <skillId>`');
  }
}

async function commandSkill(positionals, flags) {
  const action = positionals[1];
  const skillId = positionals[2];
  if (action !== 'run' || !skillId) {
    throw new Error('用法: `js-eyes skill run <skillId> <command> [args...] [--flags]`');
  }

  const paths = ensureRuntimePaths();
  const config = loadConfig();
  const sources = resolveSources(paths, config);
  const skillsDir = sources.primary;
  const skill = readSkillByIdFromSources({
    id: skillId,
    primary: skillsDir,
    extras: sources.extras,
  });
  if (!skill) {
    throw new Error(
      `技能未找到: ${skillId}（已在 primary 和 ${sources.extras.length} 个 extra 源中搜索）`,
    );
  }
  const legacyState = getLegacyOpenClawSkillState({ skillIds: [skillId] });
  if (!isSkillEnabled(config, skillId, legacyState)) {
    throw new Error(`技能已安装但未启用: ${skillId}。请先执行 \`js-eyes skills enable ${skillId}\``);
  }

  const argv = [...positionals.slice(3), ...flagsToArgv(flags)];
  const result = runSkillCli({
    skillDir: skill.skillDir,
    argv,
    stdio: 'inherit',
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

async function commandNativeHost(positionals, flags) {
  const action = positionals[1] || 'status';
  const selector = flags.browser || 'all';

  switch (action) {
    case 'install': {
      const results = installNativeHostBrowsers(selector);
      print(`Native messaging host: ${NATIVE_HOST_NAME}`);
      print(`Launcher points to: ${resolveNativeHostScript()}`);
      for (const item of results) {
        if (item.status === 'installed') {
          print(`- ${item.browser}: installed`);
          print(`    manifest: ${item.manifestPath}`);
          print(`    launcher: ${item.launcherPath}`);
          if (item.registryKey) {
            print(`    registry: ${item.registryKey}`);
          }
        } else {
          print(`- ${item.browser}: FAILED (${item.error})`);
          process.exitCode = 1;
        }
      }
      return;
    }
    case 'uninstall': {
      const results = uninstallNativeHostBrowsers(selector);
      for (const item of results) {
        if (item.status === 'uninstalled') {
          print(`- ${item.browser}: removed`);
          print(`    manifest: ${item.manifestPath}`);
          if (item.registryKey) {
            print(`    registry: ${item.registryKey}`);
          }
        } else {
          print(`- ${item.browser}: FAILED (${item.error})`);
          process.exitCode = 1;
        }
      }
      return;
    }
    case 'status': {
      const results = statusNativeHostBrowsers(selector);
      print(`Native messaging host: ${NATIVE_HOST_NAME}`);
      print(`Host script: ${resolveNativeHostScript()}`);
      for (const item of results) {
        const flag = item.installed ? 'installed' : 'missing';
        print(`- ${item.browser}: ${flag}`);
        print(`    manifest: ${item.manifestPath}`);
        if (item.manifest) {
          const allowed = item.manifest.allowed_extensions
            || (item.manifest.allowed_origins || []).map((o) => o.replace(/^chrome-extension:\/\//, '').replace(/\/$/, ''));
          print(`    allowed: ${(allowed || []).join(', ') || '(none)'}`);
        }
        print(`    launcher: ${item.launcherPath}${item.launcherExists ? '' : ' (missing)'}`);
      }
      return;
    }
    default:
      throw new Error('\u7528\u6cd5: `js-eyes native-host install|uninstall|status [--browser all|chrome|firefox|chromium|edge|brave|chromium|chrome-canary]`');
  }
}

function printHelp() {
  print('JS Eyes CLI');
  print('');
  print('Commands:');
  print('  js-eyes server start [--foreground] [--host localhost] [--port 18080]');
  print('  js-eyes server stop');
  print('  js-eyes server token [show|init|rotate] [--reveal]');
  print('  js-eyes status');
  print('  js-eyes doctor');
  print('  js-eyes audit tail [--lines 100] [--since <iso>]');
  print('  js-eyes consent list|approve <id>|deny <id>');
  print('  js-eyes egress list|approve <id>|allow <domain>|clear');
  print('  js-eyes security show|enforce <off|soft|strict>');
  print('  js-eyes config get [key]');
  print('  js-eyes config set <key> <value>');
  print('  js-eyes skills list [--registry https://js-eyes.com/skills.json]');
  print('  js-eyes skills install <skillId> [--force] [--plan] [--allow-postinstall]');
  print('  js-eyes skills approve <skillId>');
  print('  js-eyes skills verify [skillId]');
  print('  js-eyes skills enable <skillId>');
  print('  js-eyes skills disable <skillId>');
  print('  js-eyes skill run <skillId> <command> [args...]');
  print('  js-eyes openclaw plugin-path');
  print('  js-eyes extension download <chrome|firefox> [--output /tmp/file]');
  print('  js-eyes native-host install|uninstall|status [--browser all|chrome|firefox|chromium|edge|brave]');
}

async function main(argv = process.argv.slice(2)) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];

  switch (command) {
    case 'server':
      await commandServer(positionals, flags);
      return;
    case 'status':
      await commandStatus(flags);
      return;
    case 'doctor':
      await commandDoctor(flags);
      return;
    case 'config':
      await commandConfig(positionals, flags);
      return;
    case 'skills':
      await commandSkills(positionals, flags);
      return;
    case 'skill':
      await commandSkill(positionals, flags);
      return;
    case 'openclaw':
      await commandOpenClaw(positionals);
      return;
    case 'extension':
      await commandExtension(positionals, flags);
      return;
    case 'audit':
      await commandAudit(positionals, flags);
      return;
    case 'consent':
      await commandConsent(positionals, flags);
      return;
    case 'egress':
      await commandEgress(positionals, flags);
      return;
    case 'security':
      await commandSecurity(positionals, flags);
      return;
    case 'native-host':
      await commandNativeHost(positionals, flags);
      return;
    case '--help':
    case '-h':
    case 'help':
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`未知命令: ${command}`);
  }
}

module.exports = {
  commandDoctor,
  commandEgress,
  commandExtension,
  commandNativeHost,
  commandSecurity,
  commandSkill,
  commandSkills,
  commandStatus,
  flagsToArgv,
  getServerOptions,
  getLoopbackOrigin,
  isProcessAlive,
  main,
  parseArgs,
  readPid,
  resolveExtensionAsset,
  resolvePluginPath,
};
