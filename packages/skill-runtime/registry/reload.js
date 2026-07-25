'use strict';

/**
 * Reload / dispose / fingerprint helpers for SkillRegistry hot-load.
 */

function safeStringify(value) {
  try { return JSON.stringify(value); } catch (_) { return null; }
}

function stableConfigValue(value) {
  if (Array.isArray(value)) return value.map(stableConfigValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableConfigValue(value[key])]),
  );
}

function computeRuntimeConfigFingerprint(config, skillId) {
  const source = config && typeof config === 'object' ? config : {};
  const projected = {};
  for (const key of Object.keys(source)) {
    if (key === 'extraSkillDirs' || key === 'skillsEnabled' || key === 'skills') continue;
    projected[key] = source[key];
  }
  projected.skill = source.skills?.[skillId] || null;
  return safeStringify(stableConfigValue(projected)) || '';
}

/**
 * Whether an already-loaded skill must be disposed and reloaded.
 *
 * @param {any} existing
 * @param {any} skill
 * @param {{ force?: boolean, nextFingerprint?: string, nextConfigFingerprint?: string }} [options]
 */
function skillNeedsReload(existing, skill, {
  force = false,
  nextFingerprint,
  nextConfigFingerprint,
} = {}) {
  return force
    || !existing
    || existing.source !== skill.source
    || existing.sourcePath !== skill.sourcePath
    || existing.skillDir !== skill.skillDir
    || existing.fingerprint !== nextFingerprint
    || existing.configFingerprint !== nextConfigFingerprint;
}

async function callDispose(state, logger) {
  if (!state || typeof state.dispose !== 'function') return;
  try {
    await state.dispose();
  } catch (error) {
    logger.warn(
      `[js-eyes] dispose() for skill "${state.id}" threw: ${error.message}`,
    );
  }
}

function removeBindingsFor(skillId, toolBindings, actionBindings) {
  const removed = [];
  for (const [name, binding] of toolBindings) {
    if (binding.skillId === skillId) {
      toolBindings.delete(name);
      removed.push(name);
    }
  }
  for (const [action, binding] of actionBindings) {
    if (binding.skillId === skillId) {
      actionBindings.delete(action);
    }
  }
  return removed;
}

/**
 * Build the dispose callback attached to a loaded skill state.
 */
function createSkillDispose({
  adapter,
  activated,
  executionBackend,
}) {
  return async () => {
    const activeRuntime = adapter && adapter.runtime;
    if (executionBackend && typeof executionBackend.dispose === 'function') {
      await executionBackend.dispose();
    } else if (activated && typeof activated.dispose === 'function') {
      await activated.dispose();
    }
    if (activeRuntime && typeof activeRuntime.dispose === 'function') {
      await activeRuntime.dispose();
    }
  };
}

module.exports = {
  safeStringify,
  stableConfigValue,
  computeRuntimeConfigFingerprint,
  skillNeedsReload,
  callDispose,
  removeBindingsFor,
  createSkillDispose,
};
