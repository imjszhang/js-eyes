'use strict';

const {
  applySkillInstall,
  cleanupStaging,
  compareSemver,
  discoverSkillsFromSources,
  fetchSkillsRegistry,
  pkg,
  planSkillInstall,
  print,
  resolveSecurityConfig,
} = require('../../command-context');

async function handleUpdate({ config, flags, skillId, skillsDir, sources }) {
const all = Boolean(flags.all);
      if (!skillId && !all) {
        throw new Error('用法: `js-eyes skills update <skillId> [--dry-run] [--allow-postinstall]` 或 `js-eyes skills update --all`');
      }

      const registryUrl = flags.registry || config.skillsRegistryUrl;
      let registry;
      try {
        registry = await fetchSkillsRegistry(registryUrl);
      } catch (error) {
        throw new Error(`无法读取技能注册表: ${error.message}`);
      }

      const registryById = new Map((registry.skills || []).map((entry) => [entry.id, entry]));
      // The client's current parent is the CLI's own version (the CLI ships inside the parent skill).
      // registry.parentSkill.version is merely the registry snapshot's parent and must NOT drive
      // the minParentVersion gate on the user's machine.
      const parentVersion = pkg.version || (registry.parentSkill && registry.parentSkill.version) || null;

      const { skills: installed } = discoverSkillsFromSources(sources);
      const localMap = new Map(installed.map((skill) => [skill.id, skill]));

      let targets;
      if (all) {
        targets = installed
          .filter((skill) => skill.source === 'primary')
          .map((skill) => skill.id);
        if (targets.length === 0) {
          print('No primary-source skills installed; nothing to update.');
          return;
        }
      } else {
        const local = localMap.get(skillId);
        if (!local) {
          throw new Error(`技能未安装: ${skillId}`);
        }
        if (local.source === 'extra') {
          throw new Error(
            `技能 "${skillId}" 来自外部源 ${local.sourcePath}，js-eyes 不接管其生命周期（update 仅作用于 primary）。`,
          );
        }
        targets = [skillId];
      }

      const security = resolveSecurityConfig(config);
      const dryRun = Boolean(flags['dry-run']);
      const results = { upToDate: [], updated: [], skipped: [], blocked: [] };

      for (const id of targets) {
        const local = localMap.get(id);
        const entry = registryById.get(id);

        if (!entry) {
          print(`- ${id}: SKIPPED (not in registry ${registryUrl})`);
          results.skipped.push(id);
          continue;
        }

        const localVersion = (local && local.version) || '0.0.0';
        const cmp = compareSemver(localVersion, entry.version);
        if (cmp >= 0) {
          print(`- ${id}: already up to date (${localVersion})`);
          results.upToDate.push(id);
          continue;
        }

        if (entry.minParentVersion && parentVersion && compareSemver(parentVersion, entry.minParentVersion) < 0) {
          print(`- ${id}: BLOCKED (requires parent js-eyes >= ${entry.minParentVersion}, current ${parentVersion})`);
          print('    Upgrade the parent skill first, then retry.');
          results.blocked.push(id);
          continue;
        }

        print(`- ${id}: upgrading ${localVersion} -> ${entry.version}`);

        let planResult;
        try {
          planResult = await planSkillInstall({
            skillId: id,
            registryUrl,
            skillsDir,
            force: true,
            logger: console,
          });
        } catch (error) {
          print(`    plan failed: ${error.message}`);
          results.skipped.push(id);
          continue;
        }

        const plan = planResult.plan;
        print(`    source: ${plan.sourceUrl}`);
        print(`    sha256: ${plan.bundleSha256}`);
        print(`    size:   ${plan.bundleSize} bytes (${plan.stagedFiles.length} files)`);

        if (dryRun) {
          print(`    dry-run: staged at ${plan.stagingDir} (not applied)`);
          try { cleanupStaging(plan.stagingDir); } catch {}
          results.skipped.push(id);
          continue;
        }

        try {
          const apply = applySkillInstall(plan, {
            requireLockfile: security.requireLockfile,
            allowPostinstall: Boolean(flags['allow-postinstall']),
          });
          print(`    installed at ${apply.targetDir}`);
          results.updated.push(id);
        } catch (error) {
          print(`    apply failed: ${error.message}`);
          results.skipped.push(id);
        }
      }

      print('');
      print(
        `Summary: ${results.updated.length} updated, ${results.upToDate.length} up-to-date, ` +
        `${results.blocked.length} blocked, ${results.skipped.length} skipped`,
      );
      if (results.updated.length > 0 && !dryRun) {
        print('Restart the active host integration or start a new session to load the new skill tools.');
      }
      if (results.blocked.length > 0) {
        process.exitCode = 2;
      }
      return;
}

module.exports = { handleUpdate };
