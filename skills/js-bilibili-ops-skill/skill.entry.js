'use strict';

const { createSkillEntry } = require('@js-eyes/client-sdk/skill-scaffold');
const { TOOL_DEFINITIONS } = require('./skill.definition');

module.exports = createSkillEntry(TOOL_DEFINITIONS, {
    configDefaults: {
      cookiesFromBrowser: 'firefox',
      subLangs: 'zh-Hans,zh-Hant,ai-zh',
    },
  });
