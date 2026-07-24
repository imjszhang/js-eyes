'use strict';

function createLegacyRuntime(context, runtimeFactory = null) {
  const legacy = typeof runtimeFactory === 'function'
    ? runtimeFactory(context.config, context.logger)
    : {};
  return Object.freeze({
    ...legacy,
    config: legacy.config || context.config,
    logger: legacy.logger || context.logger,
    ensureBot() {
      return context.browser;
    },
    textResult(text) {
      return { content: [{ type: 'text', text }] };
    },
    jsonResult(value) {
      return this.textResult(JSON.stringify(value, null, 2));
    },
    dispose() {},
  });
}

function createLegacyHandlers(toolDefinitions = [], options = {}) {
  return Object.fromEntries(toolDefinitions.map((tool) => [
    tool.name,
    async (context, input) => tool.execute(createLegacyRuntime(context, options.createRuntime), input || {}, {
      toolCallId: context.toolCallId,
      invocationId: context.invocationId,
      signal: context.signal,
      source: context.source,
    }),
  ]));
}

module.exports = { createLegacyHandlers, createLegacyRuntime };
