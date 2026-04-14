'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const SKILL_CONTRACT_FILE = 'skill.contract.js';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadSkillContract(skillDir) {
  const contractPath = path.join(skillDir, SKILL_CONTRACT_FILE);
  if (!fs.existsSync(contractPath)) return null;
  delete require.cache[require.resolve(contractPath)];
  return require(contractPath);
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
  if (!fs.existsSync(skillsDir)) return [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => normalizeSkillMetadata(path.join(skillsDir, entry.name)))
    .filter((skill) => skill && skill.id);
}

function readSkillById(skillsDir, skillId) {
  const skillDir = path.join(skillsDir, skillId);
  if (!fs.existsSync(skillDir)) return null;
  return normalizeSkillMetadata(skillDir);
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
  return true;
}

function registerOpenClawTools(api, adapter, options = {}) {
  const logger = options.logger || api.logger || console;
  const registeredNames = options.registeredNames || null;
  const sourceName = options.sourceName || adapter?.id || 'js-eyes-skill';
  const summary = {
    registered: [],
    skipped: [],
    failed: [],
  };

  for (const tool of adapter.tools || []) {
    if (!tool || !tool.name) {
      summary.skipped.push({ name: '(anonymous)', reason: 'missing-name' });
      logger.warn(`[js-eyes] Skipping tool with missing name from ${sourceName}`);
      continue;
    }
    if (registeredNames && registeredNames.has(tool.name)) {
      summary.skipped.push({ name: tool.name, reason: 'duplicate-name' });
      logger.warn(`[js-eyes] Skipping duplicate tool "${tool.name}" from ${sourceName}`);
      continue;
    }

    try {
      api.registerTool(
        {
          name: tool.name,
          label: tool.label,
          description: tool.description,
          parameters: tool.parameters,
          execute: tool.execute,
        },
        tool.optional ? { optional: true } : undefined,
      );
      if (registeredNames) {
        registeredNames.add(tool.name);
      }
      summary.registered.push(tool.name);
    } catch (error) {
      summary.failed.push({ name: tool.name, reason: error.message });
      logger.warn(`[js-eyes] Failed to register tool "${tool.name}" from ${sourceName}: ${error.message}`);
    }
  }

  return summary;
}

async function downloadBuffer(urls, logger = console) {
  for (const url of urls) {
    const response = await fetch(url);
    if (response.ok) {
      return Buffer.from(await response.arrayBuffer());
    }
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`[js-eyes] Download failed (${url}): HTTP ${response.status}`);
    }
  }
  throw new Error('Download failed for all URLs');
}

function extractZip(zipPath, targetDir) {
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`,
      { windowsHide: true },
    );
    return;
  }
  execSync(`unzip -qo "${zipPath}" -d "${targetDir}"`);
}

function installSkillDependencies(targetDir) {
  const pkgJson = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgJson)) return;
  try {
    execSync('npm install --production', {
      cwd: targetDir,
      stdio: 'pipe',
      windowsHide: true,
    });
  } catch {
    execSync('npm install', {
      cwd: targetDir,
      stdio: 'pipe',
      windowsHide: true,
    });
  }
}

async function installSkillFromRegistry(options) {
  const {
    skillId,
    registryUrl,
    skillsDir,
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
    throw new Error(`技能 "${skillId}" 已安装在 ${targetDir}`);
  }

  const urls = skill.downloadUrlFallback
    ? [skill.downloadUrl, skill.downloadUrlFallback]
    : [skill.downloadUrl];
  const zipBuffer = await downloadBuffer(urls, logger);

  const tmpDir = path.join(os.tmpdir(), `js-eyes-skill-${Date.now()}`);
  ensureDir(tmpDir);
  const zipPath = path.join(tmpDir, `${skillId}.zip`);
  fs.writeFileSync(zipPath, zipBuffer);

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  ensureDir(targetDir);

  extractZip(zipPath, targetDir);
  installSkillDependencies(targetDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return {
    registry,
    skill,
    targetDir,
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

module.exports = {
  SKILL_CONTRACT_FILE,
  discoverLocalSkills,
  fetchSkillsRegistry,
  getLegacyOpenClawSkillState,
  getOpenClawConfigPath,
  getSkillsState,
  installSkillFromRegistry,
  isSkillEnabled,
  loadSkillContract,
  normalizeSkillMetadata,
  readSkillById,
  registerOpenClawTools,
  resolveSkillsDir,
  resolveOpenClawPluginEntry,
  runSkillCli,
};
