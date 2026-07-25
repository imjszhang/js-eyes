'use strict';

const { createSkillEntry } = require('@js-eyes/skill-scaffold');
const { TOOL_DEFINITIONS } = require('./skill.definition');

module.exports = createSkillEntry(TOOL_DEFINITIONS);
