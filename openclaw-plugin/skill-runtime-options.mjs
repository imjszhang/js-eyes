import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PROTOCOL_VERSION } = require('../packages/protocol');
const { checkCompatibility } = require('../packages/skill-contract');
const { createSkillRuntime } = require('../packages/skill-runtime');
const { createSkillWorkerBackend } = require('../packages/skill-worker');

function flattenCapabilities(descriptor = {}) {
  const declared = descriptor.capabilities || {};
  return [
    ...(declared.browser || []).map((name) => `browser.${name}`),
    ...(declared.filesystem || []).map((name) => `filesystem.${name}`),
    ...(declared.process || []).map((name) => `process.${name}`),
    ...(declared.secrets || []).map((name) => `secrets.${name}`),
    ...((declared.network?.hosts) || []).map((host) => `network.host:${host}`),
    ...(declared.network?.direct ? ['network.direct'] : []),
    ...(declared.background ? ['lifecycle.background'] : []),
  ];
}

export function createSkillRuntimeOptions(options) {
  const {
    hostVersion, loadEffectiveConfig, logger, requestTimeout,
    serverHost, serverPort, trustStore,
  } = options;
  const currentConfig = () => loadEffectiveConfig();
  const currentExternalSkills = () => currentConfig().externalSkills || {};
  const currentSkillConfig = (skillId) => currentConfig().skills?.[skillId]?.config || {};
  return {
    compatibilityChecker: (skill) => checkCompatibility(skill.descriptor?.compatibility, {
      jsEyes: hostVersion,
      contractApi: '2.0.0',
      runtimeApi: '2.0.0',
      browserProtocol: String(PROTOCOL_VERSION),
      node: process.versions.node,
    }),
    executionBackendFactory: ({ skill, runtime, logger: skillLogger }) => {
      if (skill.source !== 'extra' || skill.contractVersion !== 2) return null;
      const trust = trustStore.inspect(skill);
      const externalSkills = currentExternalSkills();
      const policy = externalSkills.policy || 'legacy';
      const executionMode = trust.approval?.executionMode
        || (policy === 'legacy' ? 'in-process' : (externalSkills.defaultExecution || 'worker'));
      return executionMode === 'worker'
        ? createSkillWorkerBackend({ skill, runtime, logger: skillLogger, requestTimeoutMs: requestTimeout * 1000 })
        : null;
    },
    runtimeFactory: ({ descriptor }) => createSkillRuntime({
      descriptor,
      skillConfig: {
        serverUrl: `ws://${serverHost}:${serverPort}`,
        requestTimeout,
        ...currentSkillConfig(descriptor.id),
      },
      configLoader: loadEffectiveConfig,
      grantedCapabilities: flattenCapabilities(descriptor),
      logger,
    }),
  };
}
