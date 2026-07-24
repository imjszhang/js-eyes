'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_FILE = 'skill.manifest.json';
const RISK_LEVELS = new Set(['read', 'interactive', 'destructive', 'administrative']);

class ManifestValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ManifestValidationError';
    this.code = 'SKILL_MANIFEST_INVALID';
    this.details = details;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ManifestValidationError(`${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function normalizeStringList(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new ManifestValidationError(`${field} must be an array`, { field });
  }
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = assertString(item, `${field}[]`);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function normalizeCapabilities(raw = {}) {
  if (!isPlainObject(raw)) {
    throw new ManifestValidationError('capabilities must be an object', { field: 'capabilities' });
  }
  const network = isPlainObject(raw.network) ? raw.network : {};
  return Object.freeze({
    browser: Object.freeze(normalizeStringList(raw.browser, 'capabilities.browser')),
    network: Object.freeze({
      direct: network.direct === true,
      hosts: Object.freeze(normalizeStringList(network.hosts, 'capabilities.network.hosts')),
    }),
    filesystem: Object.freeze(normalizeStringList(raw.filesystem, 'capabilities.filesystem')),
    process: Object.freeze(normalizeStringList(raw.process, 'capabilities.process')),
    secrets: Object.freeze(normalizeStringList(raw.secrets, 'capabilities.secrets')),
    background: raw.background === true,
  });
}

function normalizeTool(tool, index) {
  if (!isPlainObject(tool)) {
    throw new ManifestValidationError(`tools[${index}] must be an object`, { field: `tools[${index}]` });
  }
  const name = assertString(tool.name, `tools[${index}].name`);
  const inputSchema = tool.inputSchema == null
    ? { type: 'object', properties: {} }
    : tool.inputSchema;
  if (!isPlainObject(inputSchema)) {
    throw new ManifestValidationError(`tools[${index}].inputSchema must be an object`, {
      field: `tools[${index}].inputSchema`,
    });
  }
  const risk = tool.risk || 'read';
  if (!RISK_LEVELS.has(risk)) {
    throw new ManifestValidationError(`tools[${index}].risk is invalid: ${risk}`, {
      field: `tools[${index}].risk`,
    });
  }
  return Object.freeze({
    name,
    title: typeof tool.title === 'string' && tool.title.trim() ? tool.title.trim() : name,
    description: typeof tool.description === 'string' ? tool.description : '',
    inputSchema: Object.freeze({ ...inputSchema }),
    optional: tool.optional !== false,
    risk,
    capabilities: Object.freeze(normalizeStringList(tool.capabilities, `tools[${index}].capabilities`)),
  });
}

function validateSkillManifest(raw, options = {}) {
  if (!isPlainObject(raw)) {
    throw new ManifestValidationError('skill manifest must be an object');
  }
  if (raw.manifestVersion !== 2) {
    throw new ManifestValidationError('manifestVersion must be 2', { field: 'manifestVersion' });
  }
  const id = assertString(raw.id, 'id');
  const version = assertString(raw.version, 'version');
  const entry = assertString(raw.entry, 'entry');
  const toolsInput = raw.tools == null ? [] : raw.tools;
  if (!Array.isArray(toolsInput)) {
    throw new ManifestValidationError('tools must be an array', { field: 'tools' });
  }
  const tools = toolsInput.map(normalizeTool);
  const toolNames = new Set();
  for (const tool of tools) {
    if (toolNames.has(tool.name)) {
      throw new ManifestValidationError(`duplicate tool name: ${tool.name}`, { field: 'tools' });
    }
    toolNames.add(tool.name);
  }

  if (options.packageJson) {
    if (options.packageJson.name && options.packageJson.name !== id) {
      throw new ManifestValidationError(`manifest id ${id} does not match package name ${options.packageJson.name}`);
    }
    if (options.packageJson.version && options.packageJson.version !== version) {
      throw new ManifestValidationError(
        `manifest version ${version} does not match package version ${options.packageJson.version}`,
      );
    }
  }

  const compatibility = isPlainObject(raw.compatibility) ? raw.compatibility : {};
  const requirements = isPlainObject(raw.requirements) ? raw.requirements : {};
  return Object.freeze({
    manifestVersion: 2,
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
    version,
    publisher: typeof raw.publisher === 'string' ? raw.publisher.trim() : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    entry,
    compatibility: Object.freeze({ ...compatibility }),
    requirements: Object.freeze({
      server: requirements.server !== false,
      browserExtension: requirements.browserExtension !== false,
      login: requirements.login === true,
      platforms: Object.freeze(normalizeStringList(requirements.platforms, 'requirements.platforms')),
    }),
    capabilities: normalizeCapabilities(raw.capabilities),
    tools: Object.freeze(tools),
    cli: isPlainObject(raw.cli) ? Object.freeze({ ...raw.cli }) : null,
  });
}

function resolveManifestEntry(skillDir, entry, options = {}) {
  const root = path.resolve(skillDir);
  const candidate = path.resolve(root, entry);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (candidate !== root && !candidate.startsWith(prefix)) {
    throw new ManifestValidationError('manifest entry resolves outside the skill directory', { entry });
  }
  if (options.requireExisting !== false) {
    const rootReal = fs.realpathSync(root);
    const candidateReal = fs.realpathSync(candidate);
    const realPrefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
    if (candidateReal !== rootReal && !candidateReal.startsWith(realPrefix)) {
      throw new ManifestValidationError('manifest entry symlink resolves outside the skill directory', { entry });
    }
    if (!fs.statSync(candidateReal).isFile()) {
      throw new ManifestValidationError('manifest entry is not a file', { entry });
    }
    return candidateReal;
  }
  return candidate;
}

function loadSkillManifest(skillDir, options = {}) {
  const manifestPath = path.join(skillDir, MANIFEST_FILE);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ManifestValidationError(`cannot parse ${MANIFEST_FILE}: ${error.message}`);
    }
    throw error;
  }
  let packageJson = null;
  const packagePath = path.join(skillDir, 'package.json');
  if (fs.existsSync(packagePath)) {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  }
  const descriptor = validateSkillManifest(raw, { packageJson });
  const entryPath = resolveManifestEntry(skillDir, descriptor.entry, options);
  const cliEntryPath = descriptor.cli?.entry
    ? resolveManifestEntry(skillDir, assertString(descriptor.cli.entry, 'cli.entry'), options)
    : null;
  return Object.freeze({ descriptor, entryPath, cliEntryPath, manifestPath });
}

module.exports = {
  MANIFEST_FILE,
  ManifestValidationError,
  loadSkillManifest,
  resolveManifestEntry,
  validateSkillManifest,
};
