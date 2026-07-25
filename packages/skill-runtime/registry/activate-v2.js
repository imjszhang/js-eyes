'use strict';

/**
 * V2 skill activation and adapter-binding helpers.
 */

const { normalizeV2Contract } = require('@js-eyes/skill-contract');

function structuredHostResult(value) {
  if (value && typeof value === 'object' && Array.isArray(value.content)) return value;
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return {
    content: [{ type: 'text', text: text == null ? 'null' : text }],
    structuredContent: value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : { value },
  };
}

function createAdapterFromDefinition(definition, runtime, invocationSource) {
  return {
    runtime,
    tools: definition.tools.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      optional: tool.optional,
      risk: tool.risk,
      interactive: tool.interactive,
      destructive: tool.destructive,
      capabilities: tool.capabilities,
      resultMode: tool.resultMode,
      async execute(toolCallId, params) {
        const invocationOptions = {
          toolCallId,
          source: invocationSource,
          toolName: tool.name,
          risk: tool.risk,
        };
        const result = runtime && typeof runtime.invoke === 'function'
          ? await runtime.invoke(tool, params || {}, invocationOptions)
          : await tool.execute({ ...invocationOptions, runtime }, params || {});
        return tool.resultMode === 'host' ? result : structuredHostResult(result);
      },
    })),
  };
}

/**
 * Activate a V2 skill (in-process entry or execution-backend/worker path).
 *
 * @returns {Promise<{
 *   adapter: object,
 *   definition: object,
 *   runtime: object|null,
 *   activated: object|null,
 *   executionBackend: object|null,
 *   entry: object|null,
 * }>}
 */
async function activateV2Skill({
  skill,
  effectiveConfig,
  runtimeFactory,
  executionBackendFactory,
  logger,
  invocationSource,
}) {
  let runtime = null;
  let activated = null;
  let executionBackend = null;
  let entry = null;

  try {
    runtime = runtimeFactory
      ? await runtimeFactory({
          descriptor: skill.descriptor,
          skill,
          effectiveConfig,
          hostConfig: effectiveConfig,
          logger,
        })
      : null;
    executionBackend = executionBackendFactory
      ? await executionBackendFactory({
          skill,
          runtime,
          effectiveConfig,
          hostConfig: effectiveConfig,
          logger,
        })
      : null;
    if (executionBackend) {
      await executionBackend.activate();
      activated = {
        handlers: Object.fromEntries(skill.descriptor.tools.map((tool) => [
          tool.name,
          (context, input) => executionBackend.invoke(tool.name, context, input),
        ])),
      };
    } else {
      delete require.cache[require.resolve(skill.entryPath)];
      entry = require(skill.entryPath);
      activated = entry && typeof entry.activate === 'function'
        ? await entry.activate({
            descriptor: skill.descriptor,
            runtime,
            config: runtime && runtime.config ? runtime.config : {},
            logger: runtime && runtime.logger ? runtime.logger : logger,
          })
        : entry;
    }
    const definition = normalizeV2Contract(
      skill.descriptor,
      activated && activated.handlers ? activated.handlers : activated,
    );
    const adapter = createAdapterFromDefinition(definition, runtime, invocationSource);
    return { adapter, definition, runtime, activated, executionBackend, entry };
  } catch (error) {
    if (executionBackend && typeof executionBackend.dispose === 'function') {
      try { await executionBackend.dispose(); } catch (_) {}
    }
    if (runtime && typeof runtime.dispose === 'function') {
      try { await runtime.dispose(); } catch (_) {}
    }
    throw error;
  }
}

module.exports = {
  structuredHostResult,
  createAdapterFromDefinition,
  activateV2Skill,
};
