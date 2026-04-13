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

function getOpenClawConfigPath() {
  return path.join(os.homedir(), '.openclaw', 'openclaw.json');
}

function normalizeSkillMetadata(skillDir) {
  const contract = loadSkillContract(skillDir);
  const manifest = readJson(path.join(skillDir, 'openclaw-plugin', 'openclaw.plugin.json')) || {};
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
    id: contract?.id || manifest.id || pkg.name || path.basename(skillDir),
    name: contract?.name || manifest.name || pkg.name || path.basename(skillDir),
    version: contract?.version || manifest.version || pkg.version || '1.0.0',
    description: contract?.description || manifest.description || pkg.description || '',
    skillDir,
    cliEntry: cli.entry ? path.resolve(skillDir, cli.entry) : path.join(skillDir, 'index.js'),
    pluginPath: path.join(skillDir, 'openclaw-plugin'),
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

function registerOpenClawTools(api, adapter) {
  for (const tool of adapter.tools || []) {
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
  }
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
    pluginPath: path.join(targetDir, 'openclaw-plugin').replace(/\\/g, '/'),
  };
}

function updateOpenClawSkillEntry(options) {
  const {
    skillId,
    pluginPath,
    enabled = true,
    openclawConfigPath = getOpenClawConfigPath(),
  } = options;

  if (!fs.existsSync(openclawConfigPath)) {
    return { updated: false, openclawConfigPath };
  }

  const config = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8'));
  if (!config.plugins) config.plugins = {};
  if (!config.plugins.load) config.plugins.load = {};
  if (!Array.isArray(config.plugins.load.paths)) config.plugins.load.paths = [];
  if (!config.plugins.entries) config.plugins.entries = {};

  if (pluginPath && !config.plugins.load.paths.includes(pluginPath)) {
    config.plugins.load.paths.push(pluginPath);
  }
  if (!config.plugins.entries[skillId]) {
    config.plugins.entries[skillId] = {};
  }
  config.plugins.entries[skillId].enabled = enabled;

  fs.writeFileSync(openclawConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return { updated: true, openclawConfigPath };
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
  getOpenClawConfigPath,
  installSkillFromRegistry,
  loadSkillContract,
  normalizeSkillMetadata,
  readSkillById,
  registerOpenClawTools,
  resolveSkillsDir,
  resolveOpenClawPluginEntry,
  runSkillCli,
  updateOpenClawSkillEntry,
};
