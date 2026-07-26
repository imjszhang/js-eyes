import { createRequire } from 'node:module';
import { readLegacyOpenClawSkillState } from './legacy-config.mjs';

const require = createRequire(import.meta.url);
const { normalizeConfig: defaultNormalizeConfig } = require('@js-eyes/config');

export function resolveOpenClawSkillConfig({
  api,
  defaultRegistry,
  loadConfig,
  loadLegacySkillState = readLegacyOpenClawSkillState,
  normalizeConfig = defaultNormalizeConfig,
  nodePath,
  resolveSkillSources,
  skillRoot,
}) {
  const pluginConfig = api.pluginConfig ?? {};
  const hostConfig = loadConfig();
  const skillsDir = pluginConfig.skillsDir || hostConfig.skillsDir
    ? nodePath.resolve(pluginConfig.skillsDir || hostConfig.skillsDir)
    : nodePath.join(skillRoot, 'skills');
  const resolveExtraSkillDirs = () => {
    const current = loadConfig();
    return Array.from(new Set([
      ...(Array.isArray(current.extraSkillDirs) ? current.extraSkillDirs : []),
      ...(Array.isArray(pluginConfig.extraSkillDirs) ? pluginConfig.extraSkillDirs : []),
    ]));
  };
  const resolveCurrentSkillSources = () => resolveSkillSources({
    primary: skillsDir,
    extras: resolveExtraSkillDirs(),
  });
  const mergeSkills = (current) => Object.fromEntries(
    Array.from(new Set([
      ...Object.keys(current.skills || {}),
      ...Object.keys(pluginConfig.skills || {}),
    ])).map((skillId) => {
      const hostSkill = current.skills?.[skillId] || {};
      const pluginSkill = pluginConfig.skills?.[skillId] || {};
      return [skillId, {
        ...hostSkill,
        ...pluginSkill,
        config: { ...(hostSkill.config || {}), ...(pluginSkill.config || {}) },
      }];
    }),
  );
  const mergeSkillConfig = (current = hostConfig) => normalizeConfig({
    ...current,
    ...pluginConfig,
    extraSkillDirs: resolveExtraSkillDirs(),
    externalSkills: {
      ...(current.externalSkills || {}),
      ...(pluginConfig.externalSkills || {}),
    },
    skills: mergeSkills(current),
    skillsEnabled: {
      ...loadLegacySkillState(),
      ...(current.skillsEnabled || {}),
      ...(pluginConfig.skillsEnabled || {}),
    },
  });
  return {
    pluginConfig,
    hostConfig,
    effectiveSkillConfig: mergeSkillConfig(),
    loadEffectiveSkillConfig: () => mergeSkillConfig(loadConfig()),
    resolveExtraSkillDirs,
    resolveCurrentSkillSources,
    skillSources: resolveCurrentSkillSources(),
    skillsDir,
    externalSkills: mergeSkillConfig().externalSkills,
    serverHost: pluginConfig.serverHost || hostConfig.serverHost || 'localhost',
    serverPort: pluginConfig.serverPort || hostConfig.serverPort || 18080,
    autoStart: pluginConfig.autoStartServer ?? hostConfig.autoStartServer ?? true,
    requestTimeout: pluginConfig.requestTimeout || hostConfig.requestTimeout || 1800,
    skillsRegistryUrl: pluginConfig.skillsRegistryUrl || hostConfig.skillsRegistryUrl || defaultRegistry,
  };
}
