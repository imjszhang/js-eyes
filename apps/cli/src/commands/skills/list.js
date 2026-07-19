'use strict';

const {
  compareSemver,
  discoverSkillsFromSources,
  fetchSkillsRegistry,
  getLegacyOpenClawSkillState,
  isSkillEnabled,
  print,
  skillActions,
} = require('../../command-context');

async function handleList({ config, flags, skillsDir, sources }) {
const { skills: installed, conflicts } = discoverSkillsFromSources(sources);
      const installedMap = new Map(installed.map((skill) => [skill.id, skill]));
      const legacyState = getLegacyOpenClawSkillState({
        skillIds: installed.map((skill) => skill.id),
      });
      const registryUrl = flags.registry || config.skillsRegistryUrl;

      const wantJson = Boolean(flags.json);
      let registry = null;
      let registryError = null;
      try {
        registry = await fetchSkillsRegistry(registryUrl);
      } catch (error) {
        registryError = error;
        if (!wantJson && installed.length === 0) {
          throw new Error(`无法读取技能注册表: ${error.message}`);
        }
      }

      const registryById = new Map(
        registry && Array.isArray(registry.skills) ? registry.skills.map((e) => [e.id, e]) : [],
      );

      if (wantJson) {
        const extrasSummary = sources.extras.map((extra) => ({
          path: extra.path,
          kind: extra.kind,
          count: installed.filter((s) => s.source === 'extra' && s.sourcePath === extra.path).length,
        }));
        const payload = {
          primary: sources.primary,
          extras: extrasSummary,
          invalid: sources.invalid || [],
          registry: registry ? { url: registryUrl, skills: registry.skills || [] } : null,
          registryError: registryError ? registryError.message : null,
          conflicts,
          skills: installed.map((skill) => {
            const entry = registryById.get(skill.id);
            const latestVersion = entry ? entry.version : null;
            const updateAvailable =
              Boolean(entry) && skill.source === 'primary' &&
              compareSemver(skill.version || '0.0.0', entry.version) < 0;
            return {
              id: skill.id,
              name: skill.name,
              version: skill.version,
              description: skill.description,
              source: skill.source,
              sourcePath: skill.sourcePath,
              skillDir: skill.skillDir,
              actions: skillActions(skill),
              commands: skill.commands,
              enabled: isSkillEnabled(config, skill.id, legacyState),
              latestVersion,
              updateAvailable,
            };
          }),
        };
        print(JSON.stringify(payload, null, 2));
        return;
      }

      const renderSourceLine = (skill) =>
        skill.source === 'primary'
          ? '  Source: primary'
          : `  Source: extra (${skill.sourcePath})`;

      if (registry) {
        const lines = [
          `Registry: ${registryUrl}`,
          `Primary skills dir: ${skillsDir}`,
        ];
        if (sources.extras.length > 0) {
          lines.push(`Extra skill dirs: ${sources.extras.length}`);
          for (const extra of sources.extras) {
            lines.push(`  - ${extra.path} (${extra.kind})`);
          }
        }
        lines.push('');

        for (const skill of registry.skills || []) {
          const local = installedMap.get(skill.id);
          lines.push(`- ${skill.id} ${local ? '[installed]' : '[available]'}`);
          lines.push(`  ${skill.description || ''}`);
          if (Array.isArray(skill.commands) && skill.commands.length > 0) {
            lines.push(`  Commands: ${skill.commands.join(', ')}`);
          }
          const actions = skillActions(skill);
          if (actions.length > 0) {
            lines.push(`  Actions: ${actions.join(', ')}`);
          }
          if (local) {
            lines.push(`  Enabled: ${isSkillEnabled(config, skill.id, legacyState) ? 'yes' : 'no'}`);
            lines.push(`  Installed at: ${local.skillDir}`);
            lines.push(renderSourceLine(local));
            if (local.source === 'primary' && compareSemver(local.version || '0.0.0', skill.version) < 0) {
              lines.push(`  Update available: ${local.version || '?'} -> ${skill.version} (run: js-eyes skills update ${skill.id})`);
            }
          }
          lines.push('');
        }

        const extraOnly = installed.filter((s) => s.source === 'extra' && !(registry.skills || []).some((rs) => rs.id === s.id));
        if (extraOnly.length > 0) {
          lines.push(`Extra-only skills (not in registry):`);
          for (const skill of extraOnly) {
            lines.push(`- ${skill.id} [installed]`);
            lines.push(`  ${skill.description || ''}`);
            if (skill.commands.length > 0) lines.push(`  Commands: ${skill.commands.join(', ')}`);
            const actions = skillActions(skill);
            if (actions.length > 0) lines.push(`  Actions: ${actions.join(', ')}`);
            lines.push(`  Enabled: ${isSkillEnabled(config, skill.id, legacyState) ? 'yes' : 'no'}`);
            lines.push(`  Installed at: ${skill.skillDir}`);
            lines.push(renderSourceLine(skill));
            lines.push('');
          }
        }

        if (conflicts.length > 0) {
          lines.push(`Conflicts (primary-wins):`);
          for (const c of conflicts) {
            lines.push(`  - ${c.id}: kept ${c.winner.source} ${c.winner.path}, skipped ${c.loser.source} ${c.loser.path}`);
          }
        }

        print(lines.join('\n').trimEnd());
        return;
      }

      const lines = [
        `Registry unavailable: ${registryError ? registryError.message : 'unknown error'}`,
        `Primary skills dir: ${skillsDir}`,
      ];
      if (sources.extras.length > 0) {
        lines.push(`Extra skill dirs: ${sources.extras.length}`);
        for (const extra of sources.extras) {
          lines.push(`  - ${extra.path} (${extra.kind})`);
        }
      }
      lines.push('');
      for (const skill of installed) {
        lines.push(`- ${skill.id} [installed]`);
        lines.push(`  ${skill.description || ''}`);
        if (skill.commands.length > 0) {
          lines.push(`  Commands: ${skill.commands.join(', ')}`);
        }
        const actions = skillActions(skill);
        if (actions.length > 0) {
          lines.push(`  Actions: ${actions.join(', ')}`);
        }
        lines.push(`  Enabled: ${isSkillEnabled(config, skill.id, legacyState) ? 'yes' : 'no'}`);
        lines.push(`  Installed at: ${skill.skillDir}`);
        lines.push(renderSourceLine(skill));
        lines.push('');
      }
      if (conflicts.length > 0) {
        lines.push(`Conflicts (primary-wins):`);
        for (const c of conflicts) {
          lines.push(`  - ${c.id}: kept ${c.winner.source} ${c.winner.path}, skipped ${c.loser.source} ${c.loser.path}`);
        }
      }
      print(lines.join('\n').trimEnd());
      return;
}

module.exports = { handleList };
