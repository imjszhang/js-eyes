'use strict';

const { compileToolInputValidator } = require('./validation');

function normalizeRisk(tool = {}) {
  if (typeof tool.risk === 'string' && tool.risk) return tool.risk;
  if (tool.destructive === true) return 'destructive';
  if (tool.interactive === true) return 'interactive';
  return 'read';
}

function projectToolMetadata(tool = {}) {
  return Object.freeze({
    name: tool.name,
    title: tool.title || tool.label || tool.name,
    label: tool.label || tool.title || tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || tool.parameters || { type: 'object', properties: {} },
    parameters: tool.parameters || tool.inputSchema || { type: 'object', properties: {} },
    optional: tool.optional !== false,
    risk: normalizeRisk(tool),
    interactive: tool.interactive === true || normalizeRisk(tool) === 'interactive',
    destructive: tool.destructive === true || normalizeRisk(tool) === 'destructive',
    capabilities: Array.isArray(tool.capabilities) ? Object.freeze(tool.capabilities.slice()) : Object.freeze([]),
  });
}

function normalizeV1Contract(contract, options = {}) {
  if (!contract || typeof contract.createOpenClawAdapter !== 'function') {
    throw new TypeError('V1 skill contract must provide createOpenClawAdapter()');
  }
  const adapter = options.adapter || contract.createOpenClawAdapter(options.config || {}, options.logger);
  const tools = ((adapter && adapter.tools) || []).map((tool) => {
    const metadata = projectToolMetadata(tool);
    return Object.freeze({
      ...metadata,
      resultMode: 'host',
      async execute(invocation, input) {
        return tool.execute(invocation && invocation.toolCallId, input);
      },
    });
  });
  return Object.freeze({
    contractVersion: 1,
    id: contract.id,
    name: contract.name || contract.id,
    version: contract.version || '0.0.0',
    description: contract.description || '',
    requirements: Object.freeze({ ...(contract.runtime || {}) }),
    cli: contract.cli || null,
    tools: Object.freeze(tools),
    runtime: adapter && adapter.runtime,
    sourceContract: contract,
    sourceAdapter: adapter,
  });
}

function normalizeV2Contract(descriptor, entry) {
  if (!descriptor || descriptor.manifestVersion !== 2) {
    throw new TypeError('V2 skill descriptor is required');
  }
  const handlers = entry && entry.handlers ? entry.handlers : entry;
  const tools = descriptor.tools.map((tool) => {
    const handler = handlers && handlers[tool.name];
    if (typeof handler !== 'function') {
      throw new TypeError(`V2 skill entry is missing handler for ${tool.name}`);
    }
    const metadata = projectToolMetadata(tool);
    const validateInput = compileToolInputValidator(tool);
    return Object.freeze({
      ...metadata,
      resultMode: 'structured',
      async execute(context, input) {
        validateInput(input);
        return handler(context, input);
      },
    });
  });
  return Object.freeze({
    contractVersion: 2,
    id: descriptor.id,
    name: descriptor.name,
    version: descriptor.version,
    description: descriptor.description,
    requirements: descriptor.requirements,
    capabilities: descriptor.capabilities,
    compatibility: descriptor.compatibility,
    cli: descriptor.cli,
    tools: Object.freeze(tools),
    sourceEntry: entry,
  });
}

function normalizeSkillContract(contract, options = {}) {
  if (options.descriptor || (contract && contract.contractVersion === 2)) {
    return normalizeV2Contract(options.descriptor || contract, options.entry);
  }
  return normalizeV1Contract(contract, options);
}

module.exports = {
  normalizeRisk,
  normalizeSkillContract,
  normalizeV1Contract,
  normalizeV2Contract,
  projectToolMetadata,
};
