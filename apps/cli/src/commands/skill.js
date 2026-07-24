'use strict';

const {
  ensureRuntimePaths,
  createSkillTrustStore,
  flagsToArgv,
  isSkillEnabled,
  loadConfig,
  pkg,
  print,
  readSkillByIdFromSources,
  resolveSources,
  runSkillCli,
} = require('../command-context');
const { SkillHostService } = require('@js-eyes/skill-runtime');
const { checkCompatibility } = require('@js-eyes/skill-contract');
const { PROTOCOL_VERSION } = require('@js-eyes/protocol');
const path = require('path');

function assertExecutionAllowed(skill, config, paths) {
  if (skill.contractVersion === 2) {
    const compatibility = checkCompatibility(skill.descriptor?.compatibility, {
      jsEyes: pkg.version,
      contractApi: '2.0.0',
      runtimeApi: '2.0.0',
      browserProtocol: String(PROTOCOL_VERSION),
      node: process.versions.node,
    });
    if (!compatibility.compatible) {
      throw new Error(`技能与当前宿主不兼容: ${skill.id} (${JSON.stringify(compatibility.failures)})`);
    }
  }
  const policy = config.externalSkills?.policy || 'legacy';
  if (skill.source !== 'extra' || policy === 'legacy') return;
  if (skill.contractVersion !== 2) {
    throw new Error(`外部技能 ${skill.id} 使用 V1 契约，${policy} 策略拒绝执行`);
  }
  const store = createSkillTrustStore({ filePath: path.join(paths.configDir, 'skill-trust.json') });
  const trust = store.inspect(skill);
  if (!trust.approved) {
    throw new Error(`外部技能 ${skill.id} 的信任无效: ${trust.reason}。请重新 inspect/trust`);
  }
}

async function commandSkill(positionals, flags) {
  const action = positionals[1];
  const skillId = positionals[2];
  if (!['run', 'call'].includes(action) || !skillId) {
    throw new Error('用法: `js-eyes skill run <skillId> <command> [args...] [--flags]` 或 `js-eyes skill call <skillId> <tool> --args <json>`');
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
  if (!isSkillEnabled(config, skillId)) {
    throw new Error(`技能已安装但未启用: ${skillId}。请先执行 \`js-eyes skills enable ${skillId}\``);
  }
  assertExecutionAllowed(skill, config, paths);

  if (action === 'call') {
    const toolName = positionals[3];
    if (!toolName) throw new Error('用法: `js-eyes skill call <skillId> <tool> --args <json>`');
    let args = {};
    if (flags.args != null) {
      try { args = JSON.parse(String(flags.args)); } catch (error) {
        throw new Error(`--args 必须是有效 JSON: ${error.message}`);
      }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('--args 必须是 JSON 对象');
    }
    const service = new SkillHostService(config, {
      paths,
      invocationSource: 'cli',
      hostVersion: pkg.version,
      logger: {
        info: flags.json === true ? () => {} : (...values) => console.error(...values),
        warn: (...values) => console.error(...values),
        error: (...values) => console.error(...values),
      },
    });
    try {
      const result = await service.call(skillId, toolName, args);
      if (flags.json === true && result?.structuredContent) {
        print(JSON.stringify(result.structuredContent, null, 2));
      } else if (Array.isArray(result?.content)) {
        for (const item of result.content) {
          if (item && item.type === 'text') print(item.text);
        }
      } else {
        print(JSON.stringify(result, null, 2));
      }
    } finally {
      await service.dispose();
    }
    return;
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
