'use strict';

const crypto = require('crypto');
const path = require('path');
const { DEFAULT_EXTERNAL_SKILLS_CONFIG } = require('@js-eyes/config');
const { checkCompatibility } = require('@js-eyes/skill-contract');
const {
  createSkillTrustStore,
  resolveSkillSources,
  resolveSkillsDir,
} = require('@js-eyes/protocol/skills');
const { createSkillRegistry } = require('./registry');
const { PROTOCOL_VERSION } = require('@js-eyes/protocol');
const { ensureRuntimePaths } = require('@js-eyes/runtime-paths');
const { createSkillWorkerBackend } = require('./worker-backend');
const { createSkillPermissionPolicy } = require('./permissions');
const { createSkillRuntime } = require('./runtime');

function flattenCapabilities(descriptor = {}) {
  const declared = descriptor.capabilities || {};
  return [
    ...(declared.browser || []).map((name) => `browser.${name}`),
    ...(declared.filesystem || []).map((name) => `filesystem.${name}`),
    ...(declared.process || []).map((name) => `process.${name}`),
    ...(declared.secrets || []).map((name) => `secrets.${name}`),
    ...((declared.network && declared.network.hosts) || []).map((host) => `network.host:${host}`),
    ...(declared.network?.direct ? ['network.direct'] : []),
    ...(declared.background ? ['lifecycle.background'] : []),
  ];
}

class SkillHostService {
  constructor(config, options = {}) {
    this.config = config || {};
    this.configLoader = typeof options.configLoader === 'function'
      ? options.configLoader
      : () => this.config;
    this.logger = options.logger || console;
    this.registry = null;
    this.initPromise = null;
    this.paths = options.paths || ensureRuntimePaths();
    this.browserFactory = options.browserFactory;
    this.disposeBrowser = options.disposeBrowser !== false;
    this.invocationSource = options.invocationSource || 'host';
    this.hostVersion = options.hostVersion || '0.0.0';
    this.skillsDir = options.skillsDir
      || resolveSkillsDir(this.paths, this.currentConfig());
    this.extrasProvider = typeof options.extrasProvider === 'function'
      ? options.extrasProvider
      : () => this.currentConfig().extraSkillDirs || [];
    this.setConfigValue = typeof options.setConfigValue === 'function'
      ? options.setConfigValue
      : () => {};
    this.registryOptions = options.registryOptions || {};
    this.runtimeFactory = options.runtimeFactory;
    this.executionBackendFactory = options.executionBackendFactory;
    this.trustStore = options.trustStore || createSkillTrustStore({
      filePath: path.join(this.paths.configDir, 'skill-trust.json'),
    });
    this.permissionPolicy = options.permissionPolicy || createSkillPermissionPolicy({
      source: this.invocationSource,
      allowedRisks: options.allowedRisks,
      allowedCapabilities: options.allowedCapabilities,
      authorize: options.authorizeInvocation,
    });
  }

  currentConfig() {
    return this.configLoader() || this.config || {};
  }

  currentSources() {
    return resolveSkillSources({
      primary: this.skillsDir,
      extras: this.extrasProvider(),
    });
  }

  compatibilityFor(skill) {
    return checkCompatibility(skill.descriptor?.compatibility, {
      jsEyes: this.hostVersion,
      contractApi: '2.0.0',
      runtimeApi: '2.0.0',
      browserProtocol: String(PROTOCOL_VERSION),
      node: process.versions.node,
    });
  }

  createRuntimeFor({ descriptor }) {
    if (typeof this.runtimeFactory === 'function') {
      return this.runtimeFactory({ descriptor, service: this });
    }
    const config = this.currentConfig();
    const serverUrl = config.serverUrl
      || `ws://${config.serverHost || 'localhost'}:${config.serverPort || 18080}`;
    return createSkillRuntime({
      descriptor,
      skillConfig: {
        serverUrl,
        requestTimeout: config.requestTimeout,
        recording: config.recording,
        ...(config.skills?.[descriptor.id]?.config || {}),
      },
      configLoader: () => this.currentConfig(),
      grantedCapabilities: flattenCapabilities(descriptor),
      ...(this.browserFactory ? { browserFactory: this.browserFactory } : {}),
      disposeBrowser: this.disposeBrowser,
      logger: this.logger,
    });
  }

  createExecutionBackend({ skill, runtime, logger }) {
    if (typeof this.executionBackendFactory === 'function') {
      return this.executionBackendFactory({ skill, runtime, logger, service: this });
    }
    if (skill.source !== 'extra' || skill.contractVersion !== 2) return null;
    const trust = this.trustStore.inspect(skill);
    const config = this.currentConfig();
    const policy = config.externalSkills?.policy || DEFAULT_EXTERNAL_SKILLS_CONFIG.policy;
    const mode = trust.approval?.executionMode
      || (policy === 'legacy' ? 'in-process' : (config.externalSkills?.defaultExecution || 'worker'));
    return mode === 'worker'
      ? createSkillWorkerBackend({
          skill,
          runtime,
          logger,
          requestTimeoutMs: Number(config.requestTimeout || 30) * 1000,
        })
      : null;
  }

  createRegistry() {
    if (this.registry) return this.registry;
    const initialConfig = this.currentConfig();
    this.registry = createSkillRegistry({
      ...this.registryOptions,
      hostConfig: initialConfig,
      skillsDir: this.skillsDir,
      extrasProvider: () => this.extrasProvider(),
      configLoader: () => this.currentConfig(),
      setConfigValue: this.setConfigValue,
      logger: this.logger,
      invocationSource: this.invocationSource,
      externalSkillPolicy: initialConfig.externalSkills?.policy
        || DEFAULT_EXTERNAL_SKILLS_CONFIG.policy,
      externalSkillPolicyProvider: () => (
        this.currentConfig().externalSkills?.policy
        || DEFAULT_EXTERNAL_SKILLS_CONFIG.policy
      ),
      trustChecker: (skill) => this.trustStore.isApproved(skill),
      compatibilityChecker: (skill) => this.compatibilityFor(skill),
      runtimeFactory: (context) => this.createRuntimeFor(context),
      executionBackendFactory: (context) => this.createExecutionBackend(context),
      authorizeInvocation: (invocation) => this.permissionPolicy.assert(invocation),
    });
    return this.registry;
  }

  async ensureReady() {
    const registry = this.createRegistry();
    if (this.initPromise) return this.initPromise;
    if (registry.__jsEyesReady) return registry;
    this.initPromise = (async () => {
      await registry.init();
      Object.defineProperty(registry, '__jsEyesReady', {
        value: true,
        configurable: true,
      });
      return registry;
    })();
    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async list() {
    const registry = await this.ensureReady();
    return registry.snapshot().skills;
  }

  async describe(skillId) {
    const registry = await this.ensureReady();
    return registry.describeSkill(skillId);
  }

  async callAction(action, args = {}, toolCallId = null) {
    const registry = await this.ensureReady();
    return registry.executeAction(
      action,
      toolCallId || `${this.invocationSource}-${crypto.randomUUID()}`,
      args,
    );
  }

  async call(skillId, toolName, args = {}, toolCallId = null) {
    const registry = await this.ensureReady();
    const skill = registry.describeSkill(skillId);
    if (!skill) throw new Error(`Skill is not active: ${skillId}`);
    const tool = skill.tools.find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Skill tool is not active: ${skillId}/${toolName}`);
    return this.callAction(tool.action, args, toolCallId);
  }

  async reload(reason = 'manual') {
    const registry = await this.ensureReady();
    return registry.reload(reason);
  }

  async dispose() {
    if (this.registry) await this.registry.disposeAll();
    this.registry = null;
    this.initPromise = null;
  }
}

module.exports = { SkillHostService, flattenCapabilities };
