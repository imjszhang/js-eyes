'use strict';

function textResult(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

/**
 * Bind declarative tool definitions to the V2 invocation Context.
 *
 * Compatibility aliases remain context-backed: official skills use the
 * host-owned browser, config, logger, cancellation signal, and invocation
 * identity instead of constructing a second runtime/client.
 */
function createNativeHandlers(toolDefinitions = [], options = {}) {
  return Object.fromEntries(toolDefinitions.map((tool) => [
    tool.name,
    async (context, input = {}) => {
      const config = Object.freeze({
        ...(options.configDefaults || {}),
        ...context.config,
      });
      const executionContext = Object.freeze({
        ...context,
        config,
        logger: context.logger,
        ensureBot: () => context.browser,
        textResult,
        jsonResult: (value) => textResult(JSON.stringify(value, null, 2)),
      });
      return tool.execute(executionContext, input, context);
    },
  ]));
}

module.exports = { createNativeHandlers };
