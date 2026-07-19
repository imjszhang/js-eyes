'use strict';

const {
  ensureRuntimePaths,
  flagsToArgv,
  getLegacyOpenClawSkillState,
  isSkillEnabled,
  loadConfig,
  readSkillByIdFromSources,
  resolveSources,
  runSkillCli,
} = require('../command-context');

async function commandSkill(positionals, flags) {
  const action = positionals[1];
  const skillId = positionals[2];
  if (action !== 'run' || !skillId) {
    throw new Error('用法: `js-eyes skill run <skillId> <command> [args...] [--flags]`');
  }

  const paths = ensureRuntimePaths();
  const config = loadConfig();
  const sources = resolveSources(paths, config);
  const skillsDir = sources.primary;
  const skill = readSkillByIdFromSources({
    id: skillId,
    primary: skillsDir,
    extras: sources.extras,
  });
  if (!skill) {
    throw new Error(
      `技能未找到: ${skillId}（已在 primary 和 ${sources.extras.length} 个 extra 源中搜索）`,
    );
  }
  const legacyState = getLegacyOpenClawSkillState({ skillIds: [skillId] });
  if (!isSkillEnabled(config, skillId, legacyState)) {
    throw new Error(`技能已安装但未启用: ${skillId}。请先执行 \`js-eyes skills enable ${skillId}\``);
  }

  const argv = [...positionals.slice(3), ...flagsToArgv(flags)];
  const result = runSkillCli({
    skillDir: skill.skillDir,
    argv,
    stdio: 'inherit',
  });

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

module.exports = { commandSkill };
