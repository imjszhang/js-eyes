'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractZipBuffer } = require('./zip-extract');

const SKILL_CONTRACT_FILE = 'skill.contract.js';
const INTEGRITY_FILE = '.integrity.json';
const INSTALL_MANIFEST_FILE = 'skills-install.json';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadSkillContract(skillDir) {
  const contractPath = path.resolve(skillDir, SKILL_CONTRACT_FILE);
  if (!fs.existsSync(contractPath)) return null;
  delete require.cache[require.resolve(contractPath)];
  return require(contractPath);
}

function hasSkillContract(skillDir) {
  return fs.existsSync(path.join(skillDir, SKILL_CONTRACT_FILE));
}

function safeStat(target) {
  try {
    return fs.statSync(target);
  } catch (_) {
    return null;
  }
}

/**
 * 列出某个目录下被视为「候选 skill 目录」的直接子项绝对路径。
 *
 * 与裸 readdirSync 相比多做两件事：
 *   1. 把 symlink-to-directory 也视为目录（Dirent.isDirectory() 对 symlink 为 false）。
 *   2. 对于不存在 / 不可读的目录，返回空数组而不是抛错。
 *
 * 只扫 1 层，不递归。
 */
function listSkillDirectories(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const results = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(full);
      continue;
    }
    if (entry.isSymbolicLink()) {
      const stat = safeStat(full);
      if (stat && stat.isDirectory()) results.push(full);
    }
  }
  return results;
}

function resolveSkillsDir(paths, config = {}) {
  if (config.skillsDir) {
    return path.resolve(config.skillsDir);
  }
  if (paths && paths.skillsDir) {
    return paths.skillsDir;
  }
  if (paths && paths.baseDir) {
    return path.join(paths.baseDir, 'skills');
  }
  return path.resolve('skills');
}

/**
 * 归一化多源配置：primary + extras。
 *
 * 入参：
 *   - { primary, extras }：primary 是单个目录字符串；extras 是字符串数组或 undefined。
 *   - 或 { paths, config }：会自动走 resolveSkillsDir 推导 primary，并读 config.extraSkillDirs。
 *
 * 出参：
 *   {
 *     primary: '/abs/primary',
 *     extras: [{ path: '/abs/x', kind: 'skill' | 'dir' }, ...],
 *     invalid: [{ path, reason }]  // 不存在或读不到的 extra 条目
 *   }
 *
 * kind 判定：自身含 skill.contract.js => 'skill'；否则当作父目录 'dir'。
 * 对重复路径做去重（primary 自己也不会出现在 extras 里）。
 */
function resolveSkillSources(input = {}) {
  let primary = input.primary;
  let extrasInput = input.extras;

  if (!primary) {
    primary = resolveSkillsDir(input.paths, input.config || {});
  }
  primary = primary ? path.resolve(primary) : '';

  if (!extrasInput && input.config && Array.isArray(input.config.extraSkillDirs)) {
    extrasInput = input.config.extraSkillDirs;
  }

  const rawExtras = Array.isArray(extrasInput) ? extrasInput : [];
  const seen = new Set();
  if (primary) seen.add(primary);

  const extras = [];
  const invalid = [];
  for (const raw of rawExtras) {
    if (typeof raw !== 'string' || !raw.trim()) {
      invalid.push({ path: String(raw), reason: 'invalid-type' });
      continue;
    }
    const abs = path.resolve(raw);
    if (seen.has(abs)) continue;
    seen.add(abs);

    if (!fs.existsSync(abs)) {
      invalid.push({ path: abs, reason: 'not-found' });
      continue;
    }
    const stat = safeStat(abs);
    if (!stat || !stat.isDirectory()) {
      invalid.push({ path: abs, reason: 'not-a-directory' });
      continue;
    }
    const kind = hasSkillContract(abs) ? 'skill' : 'dir';
    extras.push({ path: abs, kind });
  }

  return { primary, extras, invalid };
}

function getOpenClawConfigPath(options = {}) {
  const env = options.env || process.env;
  const home = options.home || os.homedir();

  if (env.OPENCLAW_CONFIG_PATH) {
    return path.resolve(env.OPENCLAW_CONFIG_PATH);
  }
  if (env.OPENCLAW_STATE_DIR) {
    return path.resolve(env.OPENCLAW_STATE_DIR, 'openclaw.json');
  }
  if (env.OPENCLAW_HOME) {
    return path.resolve(env.OPENCLAW_HOME, '.openclaw', 'openclaw.json');
  }
  return path.join(home, '.openclaw', 'openclaw.json');
}

function normalizeSkillMetadata(skillDir) {
  const contract = loadSkillContract(skillDir);
  const pkg = readJson(path.join(skillDir, 'package.json')) || {};
  const cli = contract && contract.cli ? contract.cli : {};
  const openclaw = contract && contract.openclaw ? contract.openclaw : {};
  const tools = Array.isArray(openclaw.tools)
    ? openclaw.tools.map((tool) => tool.name)
    : [];
  const commands = Array.isArray(cli.commands)
    ? cli.commands.map((command) => command.name)
    : [];

  return {
    id: contract?.id || pkg.name || path.basename(skillDir),
    name: contract?.name || pkg.name || path.basename(skillDir),
    version: contract?.version || pkg.version || '1.0.0',
    description: contract?.description || pkg.description || '',
    skillDir,
    cliEntry: cli.entry ? path.resolve(skillDir, cli.entry) : path.join(skillDir, 'index.js'),
    commands,
    tools,
    runtime: contract?.runtime || {},
    contract,
  };
}

function discoverLocalSkills(skillsDir) {
  return listSkillDirectories(skillsDir)
    .filter((skillDir) => hasSkillContract(skillDir))
    .map((skillDir) => normalizeSkillMetadata(skillDir))
    .filter((skill) => skill && skill.id);
}

function readSkillById(skillsDir, skillId) {
  const skillDir = path.join(skillsDir, skillId);
  if (!fs.existsSync(skillDir) || !hasSkillContract(skillDir)) return null;
  return normalizeSkillMetadata(skillDir);
}

/**
 * 按 sources 发现所有可用 skill，返回带 source / sourcePath 注解的统一列表。
 *
 * sources 由 resolveSkillSources() 生成；也接受简化形态 { primary, extras: [string] }
 * （会内部再跑一遍 resolveSkillSources 归一化）。
 *
 * 冲突策略：同 id 多源命中时 primary 优先；后续 extras 里的同 id 被跳过。
 * 每次跳过会回调 onConflict({ id, winner, loser })，调用方自行决定是否打日志。
 *
 * 返回值：
 *   {
 *     skills: [{ ...normalizeSkillMetadata, source: 'primary'|'extra', sourcePath }],
 *     conflicts: [{ id, winner: { source, path }, loser: { source, path } }],
 *     invalid: sources.invalid  // 透传，便于 CLI 展示
 *   }
 */
function discoverSkillsFromSources(sources, options = {}) {
  const normalized = sources && Array.isArray(sources.extras) && sources.extras.every((e) => e && typeof e === 'object')
    ? sources
    : resolveSkillSources(sources || {});

  const { primary, extras, invalid = [] } = normalized;
  const { onConflict } = options;

  const byId = new Map();
  const conflicts = [];

  const register = (skill, source, sourcePath) => {
    if (!skill || !skill.id) return;
    if (byId.has(skill.id)) {
      const existing = byId.get(skill.id);
      const conflict = {
        id: skill.id,
        winner: { source: existing.source, path: existing.sourcePath },
        loser: { source, path: sourcePath },
      };
      conflicts.push(conflict);
      if (typeof onConflict === 'function') {
        try { onConflict(conflict); } catch (_) { /* noop */ }
      }
      return;
    }
    byId.set(skill.id, { ...skill, source, sourcePath });
  };

  if (primary) {
    for (const skill of discoverLocalSkills(primary)) {
      register(skill, 'primary', primary);
    }
  }

  for (const extra of extras) {
    if (extra.kind === 'skill') {
      if (!hasSkillContract(extra.path)) continue;
      const meta = normalizeSkillMetadata(extra.path);
      if (meta && meta.id) register(meta, 'extra', extra.path);
      continue;
    }
    for (const skill of discoverLocalSkills(extra.path)) {
      register(skill, 'extra', extra.path);
    }
  }

  return {
    skills: Array.from(byId.values()),
    conflicts,
    invalid,
  };
}

/**
 * 在 primary + extras 的联合范围内按 id 找 skill。
 * primary 优先；extras 按传入顺序其次。命中返回带 source / sourcePath 的对象，未命中返回 null。
 */
function readSkillByIdFromSources(input = {}) {
  const { id } = input;
  if (!id) return null;
  const { primary, extras } = Array.isArray(input.extras) && input.extras.every((e) => e && typeof e === 'object')
    ? input
    : resolveSkillSources(input);

  if (primary) {
    const hit = readSkillById(primary, id);
    if (hit) return { ...hit, source: 'primary', sourcePath: primary };
  }
  for (const extra of extras) {
    if (extra.kind === 'skill') {
      if (!hasSkillContract(extra.path)) continue;
      const meta = normalizeSkillMetadata(extra.path);
      if (meta && meta.id === id) return { ...meta, source: 'extra', sourcePath: extra.path };
      continue;
    }
    const hit = readSkillById(extra.path, id);
    if (hit) return { ...hit, source: 'extra', sourcePath: extra.path };
  }
  return null;
}

async function fetchSkillsRegistry(registryUrl) {
  const response = await fetch(registryUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function resolveOpenClawPluginEntry(definition) {
  try {
    const sdk = require('openclaw/plugin-sdk/plugin-entry');
    if (typeof sdk.definePluginEntry === 'function') {
      return sdk.definePluginEntry(definition);
    }
  } catch {
    // Fallback for local development without the OpenClaw SDK package installed.
  }
  return definition.register;
}

function getSkillsState(config = {}) {
  const state = config && typeof config === 'object' ? config.skillsEnabled : null;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return {};
  }
  return state;
}

function getLegacyOpenClawSkillState(options = {}) {
  const {
    openclawConfigPath = getOpenClawConfigPath(options),
    skillIds = null,
  } = options;

  if (!fs.existsSync(openclawConfigPath)) {
    return {};
  }

  let config = null;
  try {
    config = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8'));
  } catch {
    return {};
  }

  const entries = config?.plugins?.entries;
  if (!entries || typeof entries !== 'object') {
    return {};
  }

  const allowedSkillIds = Array.isArray(skillIds) && skillIds.length > 0
    ? new Set(skillIds)
    : null;
  const state = {};

  for (const [skillId, entry] of Object.entries(entries)) {
    if (skillId === 'js-eyes') {
      continue;
    }
    if (allowedSkillIds && !allowedSkillIds.has(skillId)) {
      continue;
    }
    if (!entry || typeof entry !== 'object' || entry.enabled === undefined) {
      continue;
    }
    state[skillId] = entry.enabled !== false;
  }

  return state;
}

function isSkillEnabled(config = {}, skillId, legacyState = {}) {
  const state = getSkillsState(config);
  if (Object.prototype.hasOwnProperty.call(state, skillId)) {
    return state[skillId] !== false;
  }
  if (legacyState && Object.prototype.hasOwnProperty.call(legacyState, skillId)) {
    return legacyState[skillId] !== false;
  }
  return false;
}

/**
 * 从 adapter.tools 构建 OpenClaw 工具定义列表（不执行 api.registerTool）。
 *
 * 用于 SkillRegistry 等需要"先收集再统一注册"的场景；registerOpenClawTools
 * 的注册循环基于此函数的输出。
 *
 * 返回：
 *   {
 *     toolDefs: [{ definition, optional, toolName }],  // 通过过滤的工具
 *     summary: { registered: [], skipped: [{ name, reason }], failed: [] },
 *   }
 *
 * 注意：本函数不会写入 registeredNames；由调用方在成功注册后维护。
 */
function buildAdapterTools(adapter, options = {}) {
  const logger = options.logger || console;
  const sourceName = options.sourceName || adapter?.id || 'js-eyes-skill';
  const declaredTools = Array.isArray(options.declaredTools) && options.declaredTools.length > 0
    ? new Set(options.declaredTools)
    : null;
  const registeredNames = options.registeredNames || null;
  const wrapTool = typeof options.wrapTool === 'function' ? options.wrapTool : null;

  const toolDefs = [];
  const summary = {
    registered: [],
    skipped: [],
    failed: [],
  };
  // Track names we've already emitted in this batch so intra-batch duplicates
  // are rejected even when registeredNames is not mutated here.
  const localSeen = new Set();

  for (const tool of (adapter && adapter.tools) || []) {
    if (!tool || !tool.name) {
      summary.skipped.push({ name: '(anonymous)', reason: 'missing-name' });
      logger.warn(`[js-eyes] Skipping tool with missing name from ${sourceName}`);
      continue;
    }
    if (declaredTools && !declaredTools.has(tool.name)) {
      summary.skipped.push({ name: tool.name, reason: 'undeclared' });
      logger.warn(`[js-eyes] Skipping undeclared tool "${tool.name}" from ${sourceName}`);
      continue;
    }
    if ((registeredNames && registeredNames.has(tool.name)) || localSeen.has(tool.name)) {
      summary.skipped.push({ name: tool.name, reason: 'duplicate-name' });
      logger.warn(`[js-eyes] Skipping duplicate tool "${tool.name}" from ${sourceName}`);
      continue;
    }
    localSeen.add(tool.name);

    const definition = {
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      execute: tool.execute,
    };
    const wrapped = wrapTool ? wrapTool(definition, { source: sourceName }) : definition;

    toolDefs.push({
      toolName: tool.name,
      definition: wrapped,
      optional: Boolean(tool.optional),
    });
  }

  return { toolDefs, summary };
}

function registerOpenClawTools(api, adapter, options = {}) {
  const logger = options.logger || api.logger || console;
  const registeredNames = options.registeredNames || null;
  const sourceName = options.sourceName || adapter?.id || 'js-eyes-skill';

  const { toolDefs, summary } = buildAdapterTools(adapter, {
    logger,
    sourceName,
    declaredTools: options.declaredTools,
    registeredNames,
    wrapTool: options.wrapTool,
  });

  for (const entry of toolDefs) {
    try {
      api.registerTool(entry.definition, entry.optional ? { optional: true } : undefined);
      if (registeredNames) {
        registeredNames.add(entry.toolName);
      }
      summary.registered.push(entry.toolName);
    } catch (error) {
      summary.failed.push({ name: entry.toolName, reason: error.message });
      logger.warn(`[js-eyes] Failed to register tool "${entry.toolName}" from ${sourceName}: ${error.message}`);
    }
  }

  return summary;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isMainRefUrl(url) {
  if (typeof url !== 'string') return false;
  return /\/(refs\/heads\/)?main(?=[/?])/.test(url);
}

async function downloadBuffer(urls, logger = console) {
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const buf = Buffer.from(await response.arrayBuffer());
        return { buffer: buf, url };
      }
      lastError = new Error(`HTTP ${response.status} (${url})`);
    } catch (error) {
      lastError = error;
    }
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`[js-eyes] Download failed (${url}): ${lastError?.message || 'unknown'}`);
    }
  }
  throw lastError || new Error('Download failed for all URLs');
}

function detectPackageManager(targetDir) {
  if (fs.existsSync(path.join(targetDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(targetDir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(targetDir, 'package-lock.json'))) return 'npm';
  return null;
}

function installSkillDependencies(targetDir, options = {}) {
  const pkgJson = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgJson)) return { ran: false, manager: null };

  const requireLockfile = options.requireLockfile !== false;
  const manager = detectPackageManager(targetDir);

  if (requireLockfile && manager !== 'npm') {
    throw new Error('安装拒绝执行：缺少 package-lock.json（开启 security.requireLockfile=false 可放宽）');
  }

  const ignoreScripts = options.allowPostinstall ? [] : ['--ignore-scripts'];
  const command = manager === 'npm' ? 'ci' : 'install';
  const args = [command, ...ignoreScripts, '--no-audit', '--no-fund'];

  const result = spawnSync('npm', args, {
    cwd: targetDir,
    stdio: options.stdio || 'pipe',
    windowsHide: true,
    env: { ...process.env, npm_config_ignore_scripts: options.allowPostinstall ? 'false' : 'true' },
  });

  if (result.status !== 0) {
    const stderr = result.stderr ? String(result.stderr) : '';
    throw new Error(`npm ${args.join(' ')} 失败 (status=${result.status}): ${stderr.slice(0, 500)}`);
  }

  return { ran: true, manager: manager || 'npm', allowPostinstall: Boolean(options.allowPostinstall) };
}

function listFilesRecursive(dir) {
  const out = [];
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full);
      if (rel === INTEGRITY_FILE || rel === INSTALL_MANIFEST_FILE) continue;
      if (rel.split(path.sep)[0] === 'node_modules') continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push(rel.split(path.sep).join('/'));
      }
    }
  }
  walk(dir);
  return out.sort();
}

function writeIntegrityManifest(targetDir, payload = {}) {
  const files = {};
  for (const rel of listFilesRecursive(targetDir)) {
    const full = path.join(targetDir, rel);
    files[rel] = sha256(fs.readFileSync(full));
  }
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    skillId: payload.skillId || null,
    sourceUrl: payload.sourceUrl || null,
    bundleSha256: payload.bundleSha256 || null,
    declaredTools: payload.declaredTools || [],
    files,
  };
  const filePath = path.join(targetDir, INTEGRITY_FILE);
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n');
  try { fs.chmodSync(filePath, 0o600); } catch {}
  return manifest;
}

function readSkillIntegrity(skillDir) {
  const filePath = path.join(skillDir, INTEGRITY_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function verifySkillIntegrity(skillDir) {
  const manifest = readSkillIntegrity(skillDir);
  if (!manifest || !manifest.files) {
    return { hasIntegrity: false, ok: false, mismatches: [], missing: [], extra: [], checked: 0 };
  }
  const expected = manifest.files;
  const expectedKeys = Object.keys(expected);
  const present = new Set(listFilesRecursive(skillDir));

  const mismatches = [];
  const missing = [];

  for (const rel of expectedKeys) {
    const full = path.join(skillDir, rel);
    if (!fs.existsSync(full)) {
      missing.push(rel);
      continue;
    }
    const actual = sha256(fs.readFileSync(full));
    if (actual !== expected[rel]) {
      mismatches.push(rel);
    }
  }

  const extra = [...present].filter((rel) => !Object.prototype.hasOwnProperty.call(expected, rel));

  return {
    hasIntegrity: true,
    ok: mismatches.length === 0 && missing.length === 0,
    mismatches,
    missing,
    extra,
    checked: expectedKeys.length,
  };
}

async function planSkillInstall(options) {
  const {
    skillId,
    registryUrl,
    skillsDir,
    stagingDir = path.join(os.tmpdir(), `js-eyes-skill-staging-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    force = false,
    logger = console,
  } = options;

  ensureDir(skillsDir);
  const registry = await fetchSkillsRegistry(registryUrl);
  const skill = registry.skills?.find((entry) => entry.id === skillId);
  if (!skill) {
    const ids = (registry.skills || []).map((entry) => entry.id).join(', ');
    throw new Error(`技能 "${skillId}" 未在注册表中找到。可用技能: ${ids || '无'}`);
  }

  const targetDir = path.join(skillsDir, skillId);
  if (fs.existsSync(targetDir) && !force) {
    throw new Error(`技能 "${skillId}" 已安装在 ${targetDir}（使用 force=true 覆盖）`);
  }

  if (!skill.sha256 || typeof skill.sha256 !== 'string') {
    throw new Error(`技能 "${skillId}" 注册表条目缺少 sha256 校验和，拒绝下载`);
  }

  const candidateUrls = [skill.downloadUrl];
  if (skill.downloadUrlFallback) {
    if (isMainRefUrl(skill.downloadUrlFallback)) {
      logger?.warn?.(`[js-eyes] Ignoring @main fallback URL for ${skillId} (use a tagged URL)`);
    } else {
      candidateUrls.push(skill.downloadUrlFallback);
    }
  }

  const { buffer, url } = await downloadBuffer(candidateUrls.filter(Boolean), logger);
  const digest = sha256(buffer);
  if (digest !== skill.sha256.toLowerCase()) {
    throw new Error(`技能 "${skillId}" 哈希不符: expected ${skill.sha256}, got ${digest}`);
  }
  if (typeof skill.size === 'number' && buffer.length !== skill.size) {
    throw new Error(`技能 "${skillId}" 大小不符: expected ${skill.size}, got ${buffer.length}`);
  }

  ensureDir(stagingDir);
  if (fs.existsSync(stagingDir) && fs.readdirSync(stagingDir).length > 0) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    ensureDir(stagingDir);
  }
  extractZipBuffer(buffer, stagingDir);

  const stagedFiles = listFilesRecursive(stagingDir);
  const declaredTools = Array.isArray(skill.tools) ? skill.tools.slice() : [];

  return {
    plan: {
      skillId,
      registryUrl,
      sourceUrl: url,
      bundleSha256: digest,
      bundleSize: buffer.length,
      targetDir,
      stagingDir,
      declaredTools,
      stagedFiles,
      registryEntry: skill,
      hasLockfile: fs.existsSync(path.join(stagingDir, 'package-lock.json')),
      hasPackageJson: fs.existsSync(path.join(stagingDir, 'package.json')),
    },
    skill,
    registry,
  };
}

function cleanupStaging(stagingDir) {
  if (stagingDir && fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function applySkillInstall(plan, options = {}) {
  if (!plan || !plan.stagingDir || !plan.targetDir) {
    throw new Error('applySkillInstall: invalid plan');
  }
  const requireLockfile = options.requireLockfile !== false;
  if (plan.hasPackageJson && requireLockfile && !plan.hasLockfile) {
    cleanupStaging(plan.stagingDir);
    throw new Error('技能包缺少 package-lock.json，拒绝安装（设置 security.requireLockfile=false 可放宽）');
  }

  installSkillDependencies(plan.stagingDir, {
    requireLockfile,
    allowPostinstall: Boolean(options.allowPostinstall),
  });

  if (fs.existsSync(plan.targetDir)) {
    fs.rmSync(plan.targetDir, { recursive: true, force: true });
  }
  ensureDir(path.dirname(plan.targetDir));
  fs.renameSync(plan.stagingDir, plan.targetDir);

  const integrity = writeIntegrityManifest(plan.targetDir, {
    skillId: plan.skillId,
    sourceUrl: plan.sourceUrl,
    bundleSha256: plan.bundleSha256,
    declaredTools: plan.declaredTools,
  });

  const installManifest = {
    skillId: plan.skillId,
    sourceUrl: plan.sourceUrl,
    bundleSha256: plan.bundleSha256,
    bundleSize: plan.bundleSize,
    installedAt: integrity.createdAt,
    declaredTools: plan.declaredTools,
  };
  const installManifestPath = path.join(plan.targetDir, INSTALL_MANIFEST_FILE);
  fs.writeFileSync(installManifestPath, JSON.stringify(installManifest, null, 2) + '\n');
  try { fs.chmodSync(installManifestPath, 0o600); } catch {}

  return {
    targetDir: plan.targetDir,
    integrity,
    installManifest,
  };
}

async function installSkillFromRegistry(options) {
  const { plan, skill, registry } = await planSkillInstall(options);
  const apply = applySkillInstall(plan, {
    requireLockfile: options.requireLockfile,
    allowPostinstall: options.allowPostinstall,
  });
  return {
    registry,
    skill,
    targetDir: apply.targetDir,
    integrity: apply.integrity,
    installManifest: apply.installManifest,
    plan,
  };
}

function runSkillCli(options) {
  const { skillDir, argv = [], stdio = 'inherit', env = process.env } = options;
  const skill = normalizeSkillMetadata(skillDir);
  if (!fs.existsSync(skill.cliEntry)) {
    throw new Error(`技能 ${skill.id} 缺少 CLI 入口: ${skill.cliEntry}`);
  }

  return spawnSync(process.execPath, [skill.cliEntry, ...argv], {
    cwd: skillDir,
    env: { ...env, JS_EYES_SKILL_DIR: skillDir },
    stdio,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
  });
}

// Assign to (rather than replace) module.exports so that modules which have
// already captured a reference during circular require — notably
// ./skill-registry — observe the final API once this module finishes loading.
Object.assign(module.exports, {
  INSTALL_MANIFEST_FILE,
  INTEGRITY_FILE,
  SKILL_CONTRACT_FILE,
  applySkillInstall,
  buildAdapterTools,
  cleanupStaging,
  discoverLocalSkills,
  discoverSkillsFromSources,
  fetchSkillsRegistry,
  getLegacyOpenClawSkillState,
  getOpenClawConfigPath,
  getSkillsState,
  installSkillFromRegistry,
  isSkillEnabled,
  listSkillDirectories,
  loadSkillContract,
  normalizeSkillMetadata,
  planSkillInstall,
  readSkillById,
  readSkillByIdFromSources,
  readSkillIntegrity,
  registerOpenClawTools,
  resolveSkillSources,
  resolveSkillsDir,
  resolveOpenClawPluginEntry,
  runSkillCli,
  verifySkillIntegrity,
  writeIntegrityManifest,
});

// After our own exports are populated, pull in the registry factory. This must
// happen last so skill-registry.js sees a fully-populated skills API.
const skillRegistry = require('./skill-registry');
module.exports.createSkillRegistry = skillRegistry.createSkillRegistry;
module.exports.purgeRequireCacheFor = skillRegistry.purgeRequireCacheFor;
