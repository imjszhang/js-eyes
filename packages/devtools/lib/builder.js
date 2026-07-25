'use strict';

const { MAIN_SKILL_STAGE_DIR, getVersion } = require('./build/context');
const {
  buildChrome,
  buildFirefox,
  stageAllExtensions,
  stageExtension,
} = require('./build/extensions');
const { buildSkillZip, prepareMainSkillBundleStage } = require('./build/skill-bundle');
const { parseSkillFrontmatter } = require('./build/skills-registry');
const { buildSite } = require('./build/site');
const { bump } = require('./build/versioning');

module.exports = {
  buildSite,
  buildSkillZip,
  buildChrome,
  buildFirefox,
  stageAllExtensions,
  stageExtension,
  bump,
  getVersion,
  parseSkillFrontmatter,
  MAIN_SKILL_STAGE_DIR,
  prepareMainSkillBundleStage,
};
