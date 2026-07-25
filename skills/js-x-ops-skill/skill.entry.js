'use strict';

const { createNativeHandlers } = require('@js-eyes/skill-runtime');
const { TOOL_DEFINITIONS } = require('./skill.definition');

module.exports = {
  handlers: createNativeHandlers(TOOL_DEFINITIONS, {
    configDefaults: {
      defaultMaxPages: 3,
      requestTimeout: 1800,
    },
  }),
};
