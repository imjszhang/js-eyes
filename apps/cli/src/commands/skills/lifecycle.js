'use strict';

const {
  print,
  readSkillByIdFromSources,
  setConfigValue,
} = require('../../command-context');

async function handleLifecycle({ action, skillId, skillsDir, sources }) {
if (!skillId) {
        throw new Error(`用法: \`js-eyes skills ${action} <skillId>\``);
      }
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

      const enabledValue = action === 'enable';
      setConfigValue(`skillsEnabled.${skillId}`, enabledValue);

      print(`${enabledValue ? 'Enabled' : 'Disabled'} skill: ${skillId}`);
      if (skill.source === 'extra') {
        print(`Source: extra (${skill.sourcePath})`);
      }
      print('If the OpenClaw plugin is running, it will hot-reload this change within ~300ms via the config watcher.');
      print('Otherwise, restart OpenClaw or start a new session for the change to take effect.');
      return;
}

module.exports = { handleLifecycle };
