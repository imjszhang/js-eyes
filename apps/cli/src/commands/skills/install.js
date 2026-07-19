'use strict';

const {
  applySkillInstall,
  chmodBestEffort,
  fs,
  path,
  planSkillInstall,
  print,
  readSkillByIdFromSources,
  resolveSecurityConfig,
  setConfigValue,
  skillToolActionName,
} = require('../../command-context');

async function handleInstall({ config, flags, paths, skillId, skillsDir, sources }) {
if (!skillId) {
        throw new Error('用法: `js-eyes skills install <skillId> [--force] [--plan] [--allow-postinstall]`');
      }

      const existing = readSkillByIdFromSources({
        id: skillId,
        primary: skillsDir,
        extras: sources.extras,
      });
      if (existing && existing.source === 'extra') {
        throw new Error(
          `技能 "${skillId}" 来自外部源 ${existing.sourcePath}，js-eyes 不接管其生命周期（install/uninstall 仅作用于 primary）。请直接维护该目录下的项目。`,
        );
      }

      const security = resolveSecurityConfig(config);
      const planOnly = Boolean(flags.plan);

      const planResult = await planSkillInstall({
        skillId,
        registryUrl: flags.registry || config.skillsRegistryUrl,
        skillsDir,
        force: Boolean(flags.force),
        logger: console,
      });
      const plan = planResult.plan;

      print(`Skill: ${planResult.skill.name || skillId}`);
      print(`Source: ${plan.sourceUrl}`);
      print(`SHA-256: ${plan.bundleSha256}`);
      print(`Bundle size: ${plan.bundleSize} bytes`);
      print(`Declared actions: ${(plan.declaredTools || []).map((tool) => skillToolActionName(skillId, tool)).join(', ') || '(none)'}`);
      print(`Has package-lock.json: ${plan.hasLockfile ? 'yes' : 'no'}`);
      print(`Files in bundle: ${plan.stagedFiles.length}`);
      print(`Target dir: ${plan.targetDir}`);
      print(`Staging dir: ${plan.stagingDir}`);

      if (planOnly) {
        const planFile = path.join(paths.runtimeDir, 'pending-skills', `${skillId}.json`);
        fs.mkdirSync(path.dirname(planFile), { recursive: true });
        fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + '\n');
        chmodBestEffort(planFile, 0o600);
        print('');
        print(`Plan written to ${planFile}`);
        print(`Run \`js-eyes skills approve ${skillId}\` to apply.`);
        return;
      }

      const apply = applySkillInstall(plan, {
        requireLockfile: security.requireLockfile,
        allowPostinstall: Boolean(flags['allow-postinstall']),
      });
      setConfigValue(`skillsEnabled.${skillId}`, true);

      print('');
      print('Installed.');
      print(`Location: ${apply.targetDir}`);
      print('Enabled in JS Eyes host config: yes');
      print('Integrity manifest written: .integrity.json');
      print('Restart OpenClaw or start a new session to load the new skill tools.');
      return;
}

async function handleApprove({ config, flags, paths, skillId, skillsDir, sources }) {
if (!skillId) {
        throw new Error('用法: `js-eyes skills approve <skillId>`');
      }
      const existingApprove = readSkillByIdFromSources({
        id: skillId,
        primary: skillsDir,
        extras: sources.extras,
      });
      if (existingApprove && existingApprove.source === 'extra') {
        throw new Error(
          `技能 "${skillId}" 来自外部源 ${existingApprove.sourcePath}，js-eyes 不接管其生命周期（install/approve/uninstall 仅作用于 primary）。`,
        );
      }
      const planFile = path.join(paths.runtimeDir, 'pending-skills', `${skillId}.json`);
      if (!fs.existsSync(planFile)) {
        throw new Error(`No pending plan for ${skillId}. Run \`js-eyes skills install ${skillId} --plan\` first.`);
      }
      const security = resolveSecurityConfig(config);
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      const apply = applySkillInstall(plan, {
        requireLockfile: security.requireLockfile,
        allowPostinstall: Boolean(flags['allow-postinstall']),
      });
      setConfigValue(`skillsEnabled.${skillId}`, true);
      fs.rmSync(planFile, { force: true });
      print(`Approved and installed ${skillId} at ${apply.targetDir}`);
      return;
}

module.exports = { handleInstall, handleApprove };
