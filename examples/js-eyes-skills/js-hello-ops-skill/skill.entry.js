'use strict';

/**
 * V2 entry: static handlers only. Discovery never loads this file.
 * Hosts inject context.browser; do not construct a second client here.
 */

const { TOOL_DEFINITIONS } = require('./skill.definition');

function textResult(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

function createHandlers(toolDefinitions) {
  return Object.fromEntries(toolDefinitions.map((tool) => [
    tool.name,
    async (context, input = {}) => {
      const executionContext = {
        ...context,
        config: context.config || {},
        logger: context.logger,
        ensureBot: () => context.browser,
        textResult,
        jsonResult: (value) => textResult(JSON.stringify(value, null, 2)),
      };
      const result = await tool.execute(executionContext, input, context);
      if (result && Array.isArray(result.content)) return result;
      return textResult(JSON.stringify(result, null, 2));
    },
  ]));
}

module.exports = {
  handlers: createHandlers(TOOL_DEFINITIONS),
};
