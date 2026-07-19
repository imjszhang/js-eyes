'use strict';

const {
  COMPATIBILITY_MATRIX,
  PROTOCOL_VERSION,
  classifyExtraDir,
  discoverSkillsFromSources,
  ensureRuntimePaths,
  fetchJson,
  fs,
  getLegacyOpenClawSkillState,
  getPaths,
  getServerOptions,
  getTokenFilePath,
  isLoopbackHost,
  isProcessAlive,
  isSkillEnabled,
  loadConfig,
  path,
  pkg,
  print,
  readJson,
  readPid,
  readServerToken,
  resolveNativeHostScript,
  resolvePluginPath,
  resolveSecurityConfig,
  resolveSkillRecordsDir,
  resolveSources,
  statusNativeHostBrowsers,
  verifySkillIntegrity,
} = require('../command-context');

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

function resolveTokenSource() {
  if (process.env.JS_EYES_SERVER_TOKEN) return 'env';
  const filePath = getTokenFilePath();
  if (filePath && fs.existsSync(filePath)) return 'file';
  return null;
}

function buildDoctorPosture(flags) {
  const paths = ensureRuntimePaths();
  const config = loadConfig();
  const security = resolveSecurityConfig(config);
  const { host, port } = getServerOptions(flags, config);
  const token = readServerToken();
  const sources = resolveSources(paths, config);
  const skillsDir = sources.primary;
  const verifyEnabled = Boolean(security.verifyExtraSkillDirs);

  const legacyState = getLegacyOpenClawSkillState({
    skillIds: (sources.extras || []).length > 0 ? null : [],
  });

  const skillsSummary = [];
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const dir = path.join(skillsDir, id);
      let integrity = 'unknown';
      try {
        const result = verifySkillIntegrity(dir);
        if (!result.hasIntegrity) integrity = 'no-manifest';
        else if (result.ok) integrity = 'ok';
        else integrity = 'fail';
      } catch (_) {
        integrity = 'error';
      }
      skillsSummary.push({
        id,
        source: 'primary',
        sourcePath: skillsDir,
        integrity,
        enabled: isSkillEnabled(config, id, legacyState),
      });
    }
  }

  const extrasSummary = (sources.extras || []).map((extra) => {
    const discovered = discoverSkillsFromSources({ primary: '', extras: [extra] }).skills;
    const classification = classifyExtraDir(extra.path, { enabled: verifyEnabled });
    for (const skill of discovered) {
      skillsSummary.push({
        id: skill.id,
        source: 'extra',
        sourcePath: extra.path,
        integrity: classification.state,
        enabled: isSkillEnabled(config, skill.id, legacyState),
      });
    }
    return {
      path: extra.path,
      kind: extra.kind,
      skillCount: discovered.length,
      integrity: classification.state,
    };
  });

  return {
    version: pkg.version,
    protocolVersion: COMPATIBILITY_MATRIX.protocolVersion,
    token: {
      present: Boolean(token),
      source: resolveTokenSource(),
      file: paths.tokenFile,
    },
    host: {
      serverHost: host,
      serverPort: port,
      loopback: isLoopbackHost(host),
      autoStartServer: config.autoStartServer !== false,
    },
    security: {
      allowAnonymous: Boolean(security.allowAnonymous),
      allowRawEval: Boolean(security.allowRawEval),
      allowRemoteBind: Boolean(security.allowRemoteBind),
      requireLockfile: security.requireLockfile !== false,
      verifyExtraSkillDirs: verifyEnabled,
      enforcement: security.enforcement || 'soft',
      allowedOrigins: (security.allowedOrigins || []).slice(),
    },
    policy: {
      enforcement: security.enforcement || 'soft',
      taskOrigin: {
        enabled: Boolean(security.taskOrigin?.enabled),
        sources: (security.taskOrigin?.sources || []).slice(),
      },
      taint: {
        enabled: Boolean(security.taint?.enabled),
        mode: security.taint?.mode || null,
      },
      egressAllowlist: (security.egressAllowlist || []).slice(),
    },
    paths: {
      configFile: paths.configFile,
      runtimeDir: paths.runtimeDir,
      auditLogFile: paths.auditLogFile,
      primarySkillsDir: skillsDir,
    },
    skills: skillsSummary,
    extras: extrasSummary,
    registryUrl: config.skillsRegistryUrl,
  };
}

async function commandDoctor(flags) {
  if (flags && flags.json) {
    const posture = buildDoctorPosture(flags);
    process.stdout.write(JSON.stringify(posture, null, 2) + '\n');
    return;
  }

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
    const verifyEnabled = Boolean(security.verifyExtraSkillDirs);
    print(`Extra skill dirs:`);
    for (const extra of sources.extras) {
      const extraSkills = discoverSkillsFromSources({ primary: '', extras: [extra] }).skills;
      const classification = classifyExtraDir(extra.path, { enabled: verifyEnabled });
      let integritySuffix;
      switch (classification.state) {
        case 'verified':
          integritySuffix = 'integrity: verified';
          break;
        case 'drifted':
          integritySuffix = `integrity: DRIFTED (${classification.detail.drifted.length} changed, ${classification.detail.missing.length} missing, ${classification.detail.extra.length} new) — run \`js-eyes skills relink ${extra.path}\``;
          break;
        case 'missing-snapshot':
          integritySuffix = 'integrity: no snapshot — run `js-eyes skills relink ' + extra.path + '`';
          break;
        case 'error':
          integritySuffix = `integrity: error (${classification.error})`;
          break;
        default:
          integritySuffix = 'integrity: off (security.verifyExtraSkillDirs=false)';
      }
      print(`  - ${extra.path} (${extra.kind}, ${extraSkills.length} skill${extraSkills.length === 1 ? '' : 's'}, ${integritySuffix})`);
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

module.exports = { buildDoctorPosture, commandDoctor, commandStatus };
