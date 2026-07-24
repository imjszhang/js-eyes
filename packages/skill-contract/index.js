'use strict';

const {
  MANIFEST_FILE,
  ManifestValidationError,
  loadSkillManifest,
  resolveManifestEntry,
  validateSkillManifest,
} = require('./manifest');
const {
  normalizeRisk,
  normalizeSkillContract,
  normalizeV1Contract,
  normalizeV2Contract,
  projectToolMetadata,
} = require('./normalize');
const { checkCompatibility, compareVersions, parseVersion, satisfiesRange } = require('./compatibility');
const { computeSkillSourceDigest } = require('./source-digest');
const { SkillInputValidationError, compileToolInputValidator } = require('./validation');

function defineSkill(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('defineSkill() requires a skill definition object');
  }
  return Object.freeze({ ...definition, contractVersion: definition.contractVersion || 2 });
}

module.exports = {
  MANIFEST_FILE,
  ManifestValidationError,
  SkillInputValidationError,
  checkCompatibility,
  compareVersions,
  compileToolInputValidator,
  computeSkillSourceDigest,
  defineSkill,
  loadSkillManifest,
  normalizeRisk,
  normalizeSkillContract,
  normalizeV1Contract,
  normalizeV2Contract,
  parseVersion,
  projectToolMetadata,
  resolveManifestEntry,
  satisfiesRange,
  validateSkillManifest,
};
