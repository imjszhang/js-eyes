'use strict';

/**
 * Build the common skill.definition.js export envelope.
 *
 * @param {any} [options]
 */
function createDefinitionEnvelope(options = {}) {
  const pkg = options.pkg;
  if (!pkg || !pkg.name) {
    throw new TypeError('createDefinitionEnvelope requires options.pkg');
  }
  if (!Array.isArray(options.tools) || options.tools.length === 0) {
    throw new TypeError('createDefinitionEnvelope requires non-empty options.tools');
  }
  if (!options.capabilities || !options.requirements) {
    throw new TypeError('createDefinitionEnvelope requires capabilities and requirements');
  }

  return {
    capabilities: options.capabilities,
    requirements: options.requirements,
    id: pkg.name,
    name: options.displayName || pkg.name,
    version: pkg.version,
    description: pkg.description,
    runtime: options.runtime || {
      requiresServer: !!options.requirements.server,
      requiresBrowserExtension: !!options.requirements.browserExtension,
      platforms: Array.isArray(options.requirements.platforms)
        ? options.requirements.platforms.slice()
        : [],
    },
    cli: options.cli || null,
    TOOL_DEFINITIONS: options.tools,
    ...(options.extra || {}),
  };
}

module.exports = { createDefinitionEnvelope };
