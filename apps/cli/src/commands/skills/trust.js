'use strict';

const {
  createSkillTrustStore,
  path,
  print,
  readSkillByIdFromSources,
  setConfigValue,
} = require('../../command-context');

function resolveSkill(context) {
  if (!context.skillId) {
    throw new Error(`用法: \`js-eyes skills ${context.action} <skillId>\``);
  }
  const skill = readSkillByIdFromSources({
    id: context.skillId,
    primary: context.skillsDir,
    extras: context.sources.extras,
  });
  if (!skill) throw new Error(`技能未找到: ${context.skillId}`);
  return skill;
}

function createStore(paths) {
  return createSkillTrustStore({ filePath: path.join(paths.configDir, 'skill-trust.json') });
}

function summary(skill, trust) {
  return {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    source: skill.source,
    sourcePath: skill.sourcePath,
    contractVersion: skill.contractVersion || 1,
    publisher: skill.descriptor?.publisher || '',
    requirements: skill.descriptor?.requirements || skill.runtime || {},
    capabilities: skill.descriptor?.capabilities || null,
    tools: skill.descriptor?.tools || skill.tools || [],
    trust,
  };
}

function output(value, json) {
  if (json) {
    print(JSON.stringify(value, null, 2));
    return;
  }
  print(`Skill: ${value.id}@${value.version}`);
  print(`Source: ${value.source}${value.sourcePath ? ` (${value.sourcePath})` : ''}`);
  print(`Contract: V${value.contractVersion}`);
  print(`Publisher: ${value.publisher || '(unspecified)'}`);
  print(`Trust: ${value.trust.approved ? 'approved' : `not approved (${value.trust.reason})`}`);
  print(`Capabilities: ${JSON.stringify(value.capabilities || {})}`);
  print(`Tools: ${Array.isArray(value.tools) ? value.tools.map((tool) => tool.name || tool).join(', ') : ''}`);
}

async function handleTrustAction(context) {
  const skill = resolveSkill(context);
  const store = createStore(context.paths);

  if (context.action === 'inspect' || context.action === 'permissions') {
    output(summary(skill, store.inspect(skill)), context.flags.json === true);
    return;
  }

  if (skill.source !== 'extra') {
    throw new Error(`${context.action} 仅适用于 extraSkillDirs 中的外部技能`);
  }
  if (context.action === 'trust') {
    if (skill.contractVersion !== 2 || !skill.descriptor) {
      throw new Error('旧版外部技能没有静态 Manifest，不能建立细粒度信任；请迁移到 skill.manifest.json 或使用 legacy 策略');
    }
    const executionMode = context.flags.execution || context.config.externalSkills?.defaultExecution || 'worker';
    if (!['worker', 'in-process'].includes(executionMode)) {
      throw new Error('--execution 必须是 worker 或 in-process');
    }
    const approval = store.approve(skill, { executionMode });
    setConfigValue(`skillsEnabled.${skill.id}`, true);
    print(`Trusted external skill: ${skill.id}`);
    print(`Execution: ${approval.executionMode}`);
    print(`Source: ${approval.sourceRealpath}`);
    print(`Capabilities: ${JSON.stringify(approval.capabilities || {})}`);
    return;
  }
  if (context.action === 'revoke') {
    const removed = store.revoke(skill);
    setConfigValue(`skillsEnabled.${skill.id}`, false);
    print(`${removed ? 'Revoked' : 'No approval found for'} external skill: ${skill.id}`);
  }
}

module.exports = { handleTrustAction };
