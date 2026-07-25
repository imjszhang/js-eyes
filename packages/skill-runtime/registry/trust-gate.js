'use strict';

/**
 * Trust / integrity / approval gates for loading external and primary skills.
 */

const { verifyExtraDir: verifyExtraSkillDir } = require('@js-eyes/skill-install/extra-integrity');
const { isBundledPrimarySkill } = require('./discover');

/**
 * Verify integrity for an extra or primary skill before load.
 *
 * @param {any} skill
 * @param {object} options
 * @param {any} [options.cfg]
 * @param {() => any} options.configLoader
 * @param {(skillDir: string) => any} options.verifySkillIntegrity
 * @param {{ info: Function, warn: Function, error: Function }} options.logger
 * @returns {{ ok: boolean, skipped?: boolean }}
 */
function checkIntegrity(skill, {
  cfg = null,
  configLoader,
  verifySkillIntegrity,
  logger,
}) {
  if (skill.source === 'extra') {
    const effectiveCfg = cfg || configLoader();
    const verifyEnabled = Boolean(
      effectiveCfg
      && effectiveCfg.security
      && effectiveCfg.security.verifyExtraSkillDirs,
    );
    if (!verifyEnabled) return { ok: true, skipped: true };
    // `sourcePath` for extras is the root that was passed via `extraSkillDirs`
    // (either a skill dir or a parent dir). Verify that root — that matches
    // what `snapshotExtraDir(abs-path)` was asked to capture.
    const extraRoot = skill.sourcePath || skill.skillDir;
    const result = verifyExtraSkillDir(extraRoot);
    if (!result.hasSnapshot) {
      logger.warn(
        `[js-eyes] Refused extra skill "${skill.id}": no integrity snapshot for ${extraRoot}, run \`js-eyes skills relink ${extraRoot}\``,
      );
      return { ok: false };
    }
    if (!result.ok) {
      logger.warn(
        `[js-eyes] Refused extra skill "${skill.id}": integrity drift at ${extraRoot} (${result.drifted.length} changed, ${result.missing.length} missing, ${result.extra.length} new), run \`js-eyes skills relink ${extraRoot}\``,
      );
      return { ok: false };
    }
    return { ok: true };
  }
  if (skill.source !== 'primary') return { ok: true, skipped: true };
  const integrity = verifySkillIntegrity(skill.skillDir);
  if (integrity.hasIntegrity && !integrity.ok) {
    logger.warn(
      `[js-eyes] Refusing to load tampered skill "${skill.id}": ${integrity.mismatches.length} mismatched, ${integrity.missing.length} missing`,
    );
    return { ok: false };
  }
  if (!integrity.hasIntegrity) {
    if (isBundledPrimarySkill(skill)) {
      logger.info(
        `[js-eyes] Skill "${skill.id}" has no .integrity.json because it is loaded from the bundled/source primary skills directory (${skill.sourcePath}); load allowed. Registry-installed primary skills should carry .integrity.json for tamper checks.`,
      );
    } else {
      logger.warn(
        `[js-eyes] Skill "${skill.id}" has no .integrity.json (legacy primary install); load allowed, but reinstall via \`js-eyes skills install ${skill.id}\` to restore tamper-check metadata`,
      );
    }
  }
  return { ok: true };
}

/**
 * Gate external skills by policy and trust approval.
 *
 * @param {any} skill
 * @param {object} options
 * @param {() => string} options.getExternalSkillPolicy
 * @param {(skill: any) => boolean} options.trustChecker
 * @param {{ info: Function, warn: Function, error: Function }} options.logger
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string }}
 */
function checkExternalTrust(/** @type {any} */ skill, {
  getExternalSkillPolicy,
  trustChecker,
  logger,
}) {
  if (skill.source !== 'extra') {
    return { ok: true, skipped: true };
  }
  // Resolve policy so removed/unknown values emit the registry warning, then require trust.
  getExternalSkillPolicy();
  if (skill.contractVersion !== 2) {
    logger.warn(
      `[js-eyes] Refused external skill "${skill.id}" because V1 contracts are no longer supported; `
      + 'migrate to skill.manifest.json + skill.entry.js',
    );
    return { ok: false, reason: 'legacy-contract' };
  }
  let trusted = false;
  try { trusted = trustChecker(skill) === true; } catch (_) { trusted = false; }
  if (!trusted) {
    logger.warn(
      `[js-eyes] External skill "${skill.id}" discovered but not trusted; inspect and approve it before loading`,
    );
    return { ok: false, reason: 'not-trusted' };
  }
  return { ok: true };
}

module.exports = {
  checkIntegrity,
  checkExternalTrust,
};
