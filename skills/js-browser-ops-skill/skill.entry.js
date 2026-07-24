'use strict';

const { createLegacyHandlers } = require('@js-eyes/skill-runtime/legacy-entry');
const { TOOL_DEFINITIONS, createRuntime } = require('./skill.contract');

module.exports = { handlers: createLegacyHandlers(TOOL_DEFINITIONS, { createRuntime }) };
