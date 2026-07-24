'use strict';

const crypto = require('crypto');
const path = require('path');
const { checkCompatibility } = require('@js-eyes/skill-contract');
const { createSkillRegistry, createSkillTrustStore, resolveSkillSources, resolveSkillsDir } = require('@js-eyes/protocol/skills');
const { PROTOCOL_VERSION } = require('@js-eyes/protocol');
const { ensureRuntimePaths } = require('@js-eyes/runtime-paths');
const { createSkillWorkerBackend } = require('@js-eyes/skill-worker');
const { createSkillRuntime } = require('./runtime');
const { SkillRiskError } = require('./errors');

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
    this.config = config;
    this.logger = options.logger || console;
    this.registry = null;
    this.initPromise = null;
    this.paths = options.paths || ensureRuntimePaths();
    this.browserFactory = options.browserFactory;
    this.disposeBrowser = options.disposeBrowser !== false;
    this.invocationSource = options.invocationSource || 'host';
    this.hostVersion = options.hostVersion || '0.0.0';
    this.allowedRisks = new Set(options.allowedRisks || ['read', 'interactive', 'administrative', 'destructive']);
    this.sources = resolveSkillSources({
      primary: resolveSkillsDir(this.paths, config),
      extras: config.extraSkillDirs || [],
    });
    this.trustStore = options.trustStore || createSkillTrustStore({
      filePath: path.join(this.paths.configDir, 'skill-trust.json'),
    });
  }

  async ensureReady() {
    if (this.registry) return this.registry;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const config = this.config;
      const registry = createSkillRegistry({
        skillsDir: this.sources.primary,
        extrasProvider: () => this.sources.extras.map((entry) => entry.path),
        configLoader: () => config,
        setConfigValue: () => {},
        logger: this.logger,
        suppressSelfWrites: false,
        invocationSource: this.invocationSource,
        externalSkillPolicy: config.externalSkills?.policy || 'legacy',
        trustChecker: (skill) => this.trustStore.isApproved(skill),
        compatibilityChecker: (skill) => checkCompatibility(skill.descriptor?.compatibility, {
          jsEyes: this.hostVersion,
          contractApi: '2.0.0',
          runtimeApi: '2.0.0',
          browserProtocol: String(PROTOCOL_VERSION),
          node: process.versions.node,
        }),
        runtimeFactory: ({ descriptor }) => createSkillRuntime({
          descriptor,
          skillConfig: {
            serverUrl: config.serverUrl,
            requestTimeout: config.requestTimeout,
            recording: config.recording,
            ...(config.skills?.[descriptor.id]?.config || {}),
          },
          configLoader: () => config,
          grantedCapabilities: flattenCapabilities(descriptor),
          ...(this.browserFactory ? { browserFactory: this.browserFactory } : {}),
          disposeBrowser: this.disposeBrowser,
          logger: this.logger,
        }),
        executionBackendFactory: ({ skill, runtime, logger }) => {
          if (skill.source !== 'extra' || skill.contractVersion !== 2) return null;
          const trust = this.trustStore.inspect(skill);
          const policy = config.externalSkills?.policy || 'legacy';
          const mode = trust.approval?.executionMode
            || (policy === 'legacy' ? 'in-process' : (config.externalSkills?.defaultExecution || 'worker'));
          return mode === 'worker'
            ? createSkillWorkerBackend({ skill, runtime, logger, requestTimeoutMs: config.requestTimeout * 1000 })
            : null;
        },
      });
      await registry.init();
      this.registry = registry;
      return registry;
    })();
    try { return await this.initPromise; } finally { this.initPromise = null; }
  }

  async list() {
    const registry = await this.ensureReady();
    return registry.snapshot().skills;
  }

  async describe(skillId) {
    const registry = await this.ensureReady();
    return registry.describeSkill(skillId);
  }

  async call(skillId, toolName, args = {}, toolCallId = null) {
    const registry = await this.ensureReady();
    const skill = registry.describeSkill(skillId);
    if (!skill) throw new Error(`Skill is not active: ${skillId}`);
    const tool = skill.tools.find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Skill tool is not active: ${skillId}/${toolName}`);
    if (!this.allowedRisks.has(tool.risk || 'read')) {
      throw new SkillRiskError(tool.risk || 'read', this.invocationSource);
    }
    return registry.executeAction(
      tool.action,
      toolCallId || `${this.invocationSource}-${crypto.randomUUID()}`,
      args,
    );
  }

  async dispose() {
    if (this.registry) await this.registry.disposeAll();
    this.registry = null;
  }
}

module.exports = { SkillHostService, flattenCapabilities };
