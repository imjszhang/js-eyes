export function registerSkillDiscoveryActions({
  api,
  chmodBestEffort,
  discoverSkillsFromSources,
  fetchSkillsRegistry,
  loadConfig,
  nodeFs,
  nodePath,
  planSkillInstall,
  registerCoreAction,
  resolveSkillSources,
  runtimePaths,
  skillToolActionName,
  skillsDir,
  skillsRegistryUrl,
  textResult,
}) {
registerCoreAction(
    "skills/discover",
    {
      name: "skills/discover",
      label: "JS Eyes: Discover Skills",
      description: "查询 JS Eyes 扩展技能注册表，列出可安装的扩展技能（如 X.com 搜索等）。返回每个技能的 ID、名称、描述、版本、可通过 js-eyes 调用的 action 和安装命令。",
      parameters: {
        type: "object",
        properties: {
          registryUrl: {
            type: "string",
            description: "自定义注册表 URL（默认使用 js-eyes.com/skills.json）",
          },
        },
      },
      async execute(_toolCallId, params) {
        const url = params.registryUrl || skillsRegistryUrl;
        try {
          const registry = await fetchSkillsRegistry(url);
          // Re-resolve sources at call time so freshly linked extras are reflected.
          const freshConfig = loadConfig();
          const freshSources = resolveSkillSources({
            primary: skillsDir,
            extras: Array.isArray(freshConfig.extraSkillDirs) ? freshConfig.extraSkillDirs : [],
          });
          const installedSkills = new Set(
            discoverSkillsFromSources(freshSources).skills.map((skill) => skill.id),
          );

          if (!registry.skills || registry.skills.length === 0) {
            return textResult("当前没有可用的扩展技能。");
          }

          const lines = [
            `## JS Eyes 扩展技能 (${registry.skills.length} 个)`,
            `Parent: js-eyes v${registry.parentSkill?.version || "?"}`,
            "",
          ];

          for (const s of registry.skills) {
            const installed = installedSkills.has(s.id);
            const status = installed ? "✓ 已安装" : "○ 未安装";
            lines.push(`### ${s.emoji || ""} ${s.name} (${s.id}) — ${status}`);
            lines.push(`  ${s.description}`);
            lines.push(`  版本: ${s.version}`);
            const actions = Array.isArray(s.actions)
              ? s.actions
              : (Array.isArray(s.tools) ? s.tools.map((tool) => skillToolActionName(s.id, tool)) : []);
            if (actions.length > 0) {
              lines.push(`  Actions: ${actions.join(", ")}`);
            }
            if (s.commands && s.commands.length > 0) {
              lines.push(`  CLI 命令: ${s.commands.join(", ")}`);
            }
            if (s.requires?.skills?.length > 0) {
              lines.push(`  依赖: ${s.requires.skills.join(", ")}`);
            }
            if (!installed) {
              lines.push(`  安装: 调用 js-eyes 工具，action="skills/plan-install"，args.skillId="${s.id}"`);
              lines.push(`  或命令行: curl -fsSL https://js-eyes.com/install.sh | bash -s -- ${s.id}`);
            }
            lines.push("");
          }

          return textResult(lines.join("\n"));
        } catch (err) {
          return textResult(`获取技能注册表失败 (${url}): ${err.message}`);
        }
      },
    },
  );

registerCoreAction(
    "skills/plan-install",
    {
      name: "skills/plan-install",
      label: "JS Eyes: Plan Skill Install",
      description: "下载并校验一个 JS Eyes 扩展技能的安装计划：核对 SHA-256、解到 staging 目录、列出工具/依赖。出于安全考虑，不会自动启用或写入到 skills 目录；需要用户在终端执行 `js-eyes skills approve <skillId>` 才会真正落地。",
      parameters: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "要安装的技能 ID（如 'js-x-ops-skill'）",
          },
          force: {
            type: "boolean",
            description: "如果该技能已经安装，是否允许覆盖（仍然只生成计划）",
          },
        },
        required: ["skillId"],
      },
      async execute(_toolCallId, params) {
        const { skillId, force } = params;
        try {
          const planResult = await planSkillInstall({
            skillId,
            registryUrl: skillsRegistryUrl,
            skillsDir,
            force,
            logger: api.logger,
          });
          const plan = planResult.plan;
          const planFile = nodePath.join(runtimePaths.runtimeDir, 'pending-skills', `${skillId}.json`);
          nodeFs.mkdirSync(nodePath.dirname(planFile), { recursive: true });
          nodeFs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + '\n');
          chmodBestEffort(planFile, 0o600);

          const lines = [
            `已生成安装计划，但未执行。请人工 review 后批准。`,
            `  技能: ${planResult.skill.name} (${skillId})`,
            `  来源: ${plan.sourceUrl}`,
            `  SHA-256: ${plan.bundleSha256}`,
            `  Bundle 大小: ${plan.bundleSize} bytes`,
            `  声明 actions: ${(plan.declaredTools || []).map((tool) => skillToolActionName(skillId, tool)).join(', ') || '(none)'}`,
            `  依赖锁文件: ${plan.hasLockfile ? '存在' : '缺失'}`,
            `  Staging: ${plan.stagingDir}`,
            `  目标: ${plan.targetDir}`,
            ``,
            `请在主机终端执行: js-eyes skills approve ${skillId}`,
            `（也可以直接执行 \`js-eyes skills install ${skillId}\` 来在终端审阅+安装）`,
          ];
          return textResult(lines.join("\n"));
        } catch (err) {
          return textResult(`生成安装计划失败 (${skillId}): ${err.message}`);
        }
      },
    },
  );
}
