'use strict';

const fs = require('fs');
const path = require('path');

function normalizeBrowserCapabilities(capabilities) {
  if (!capabilities) return [];
  if (Array.isArray(capabilities.browser)) return capabilities.browser.slice();
  return [];
}

function toolCapabilities(tool) {
  if (Array.isArray(tool.capabilities) && tool.capabilities.length > 0) {
    return tool.capabilities.slice();
  }
  throw new Error(`Tool ${tool.name} is missing capabilities[] (TOOL_DEFINITIONS is SSOT)`);
}

function toolRisk(tool) {
  if (tool.risk) return tool.risk;
  throw new Error(`Tool ${tool.name} is missing risk (TOOL_DEFINITIONS is SSOT)`);
}

/**
 * Build a V2 skill.manifest.json object from package.json + skill.definition.js exports.
 *
 * @param {string} skillDir absolute skill directory
 * @param {any} [loaded] optional preloaded { packageJson, contract }
 */
function buildSkillManifest(skillDir, loaded = {}) {
  const packageJson = loaded.packageJson || require(path.join(skillDir, 'package.json'));
  const contract = loaded.contract || require(path.join(skillDir, 'skill.definition.js'));
  const tools = contract.TOOL_DEFINITIONS;
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error(`${packageJson.name}: TOOL_DEFINITIONS must be a non-empty array`);
  }
  if (!contract.capabilities || !contract.requirements) {
    throw new Error(`${packageJson.name}: skill.definition.js must export capabilities and requirements`);
  }

  const platforms = contract.requirements.platforms
    || contract.runtime?.platforms
    || [];

  return {
    manifestVersion: 2,
    id: packageJson.name,
    name: contract.name || packageJson.name,
    version: packageJson.version,
    publisher: contract.publisher || 'js-eyes',
    description: packageJson.description,
    entry: './skill.entry.js',
    compatibility: {
      jsEyes: '>=2.8.5 <3',
      contractApi: '^2.0.0',
      runtimeApi: '^2.0.0',
      node: '>=22',
    },
    requirements: {
      server: !!contract.requirements.server,
      browserExtension: !!contract.requirements.browserExtension,
      login: !!contract.requirements.login,
      platforms: platforms.slice(),
    },
    capabilities: {
      browser: normalizeBrowserCapabilities(contract.capabilities),
      network: {
        direct: !!contract.capabilities.network?.direct,
        hosts: Array.isArray(contract.capabilities.network?.hosts)
          ? contract.capabilities.network.hosts.slice()
          : [],
      },
      filesystem: Array.isArray(contract.capabilities.filesystem)
        ? contract.capabilities.filesystem.slice()
        : ['skillData'],
      process: Array.isArray(contract.capabilities.process)
        ? contract.capabilities.process.slice()
        : [],
      secrets: Array.isArray(contract.capabilities.secrets)
        ? contract.capabilities.secrets.slice()
        : [],
      background: !!contract.capabilities.background,
    },
    cli: contract.cli || null,
    tools: tools.map((tool) => {
      const inputSchema = tool.parameters || tool.inputSchema || { type: 'object', properties: {} };
      return {
        name: tool.name,
        title: tool.label || tool.title || tool.name,
        description: tool.description || '',
        risk: toolRisk(tool),
        capabilities: toolCapabilities(tool),
        inputSchema,
      };
    }),
  };
}

function writeSkillManifest(skillDir, options = {}) {
  const manifest = buildSkillManifest(skillDir);
  const manifestPath = path.join(skillDir, 'skill.manifest.json');
  const expected = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!options.dryRun) {
    fs.writeFileSync(manifestPath, expected);
  }
  return { manifestPath, manifest, expected };
}

module.exports = {
  buildSkillManifest,
  writeSkillManifest,
};
