'use strict';

const { createNativeHandlers } = require('@js-eyes/skill-runtime');

/**
 * Standard V2 skill.entry.js body.
 *
 * @param {Array<object>} toolDefinitions TOOL_DEFINITIONS from skill.definition.js
 * @param {object} [options] forwarded to createNativeHandlers (e.g. configDefaults)
 * @returns {{ handlers: Record<string, Function> }}
 */
function createSkillEntry(toolDefinitions, options = {}) {
  return {
    handlers: createNativeHandlers(toolDefinitions, options),
  };
}

module.exports = { createSkillEntry };
