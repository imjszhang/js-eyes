'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const pluginRoot = path.join(repoRoot, 'openclaw-plugin');

describe('OpenClaw module boundaries', () => {
  it('owns OpenClaw config path and legacy skill-state compatibility', async () => {
    const os = require('os');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-openclaw-state-'));
    try {
      const {
        getOpenClawConfigPath,
        readLegacyOpenClawSkillState,
      } = await import('../openclaw-plugin/legacy-config.mjs');
      assert.equal(getOpenClawConfigPath({
        env: { OPENCLAW_CONFIG_PATH: '/tmp/custom-openclaw.json' },
        home: '/tmp/fallback-home',
      }), path.resolve('/tmp/custom-openclaw.json'));
      assert.equal(getOpenClawConfigPath({
        env: { OPENCLAW_STATE_DIR: '/tmp/state-dir' },
        home: '/tmp/fallback-home',
      }), path.resolve('/tmp/state-dir', 'openclaw.json'));
      assert.equal(getOpenClawConfigPath({
        env: { OPENCLAW_HOME: '/tmp/openclaw-home' },
        home: '/tmp/fallback-home',
      }), path.resolve('/tmp/openclaw-home', '.openclaw', 'openclaw.json'));

      const configPath = path.join(tempDir, 'openclaw.json');
      fs.writeFileSync(configPath, JSON.stringify({
        plugins: {
          entries: {
            'js-eyes': { enabled: true },
            'js-x-ops-skill': { enabled: false },
            'js-youtube-ops-skill': { enabled: true },
          },
        },
      }));
      assert.deepEqual(readLegacyOpenClawSkillState({ configPath }), {
        'js-x-ops-skill': false,
        'js-youtube-ops-skill': true,
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps the plugin entrypoint as a thin composition layer', () => {
    const entry = fs.readFileSync(path.join(pluginRoot, 'index.mjs'), 'utf8');
    assert.ok(entry.split('\n').length <= 300, 'openclaw-plugin/index.mjs must stay below 300 lines');
    assert.doesNotMatch(entry, /chokidar\.watch/);
    assert.doesNotMatch(entry, /registerCoreAction\(\s*["']browser\//);

    const moduleFiles = [
      'actions/browser.mjs',
      'actions/management.mjs',
      'actions/skills.mjs',
      'cli-registration.mjs',
      'lifecycle.mjs',
      'legacy-config.mjs',
      'registration-context.mjs',
      'server-service.mjs',
      'shared-server.mjs',
      'skill-config.mjs',
      'tool-policy.mjs',
      'tool-router.mjs',
      'watchers.mjs',
    ];
    for (const relativePath of moduleFiles) {
      const source = fs.readFileSync(path.join(pluginRoot, relativePath), 'utf8');
      assert.ok(source.split('\n').length <= 700, `${relativePath} became a new hotspot`);
      assert.doesNotMatch(source, /from ["'][^"']*index\.mjs["']/);
    }
  });

  it('preserves the complete built-in action contract', async () => {
    const { registerBrowserActions } = await import('../openclaw-plugin/actions/browser.mjs');
    const { registerSkillDiscoveryActions } = await import('../openclaw-plugin/actions/skills.mjs');
    const { registerManagementActions } = await import('../openclaw-plugin/actions/management.mjs');
    const actions = [];
    const registerCoreAction = (name, definition) => actions.push({ name, definition });

    registerBrowserActions({ registerCoreAction });
    registerSkillDiscoveryActions({ registerCoreAction });
    registerManagementActions({ registerCoreAction });

    assert.deepEqual(actions.map((entry) => entry.name), [
      'browser/get-tabs',
      'browser/list-clients',
      'browser/open-url',
      'browser/close-tab',
      'browser/get-html',
      'browser/execute-script',
      'browser/get-cookies',
      'browser/inject-css',
      'browser/get-cookies-by-domain',
      'browser/get-page-info',
      'browser/upload-file',
      'skills/discover',
      'skills/plan-install',
      'skills/reload',
      'security/reload',
    ]);
    for (const { name, definition } of actions) {
      assert.equal(definition.name, name);
      assert.equal(typeof definition.description, 'string');
      assert.equal(definition.parameters.type, 'object');
      assert.equal(typeof definition.execute, 'function');
    }
  });

  it('merges host and plugin Skill config and refreshes linked extras', async () => {
    const { resolveOpenClawSkillConfig } = await import('../openclaw-plugin/skill-config.mjs');
    let host = {
      serverHost: 'host-config',
      skillsDir: '/host/primary',
      extraSkillDirs: ['/host/a'],
      externalSkills: { policy: 'prompt', defaultExecution: 'worker' },
      skills: {
        demo: { config: { fromHost: true, value: 1 } },
        dynamic: { config: { value: 1 } },
      },
    };
    const resolved = resolveOpenClawSkillConfig({
      api: { pluginConfig: {
        serverHost: 'plugin-config',
        extraSkillDirs: ['/plugin/b'],
        externalSkills: { policy: 'strict' },
        skills: { demo: { config: { value: 2 } } },
      } },
      defaultRegistry: 'https://registry.example',
      loadConfig: () => host,
      loadLegacySkillState: () => ({ legacy: true }),
      nodePath: path,
      resolveSkillSources: ({ primary, extras }) => ({ primary, extras }),
      skillRoot: '/bundle',
    });
    assert.equal(resolved.serverHost, 'plugin-config');
    assert.deepEqual(resolved.resolveExtraSkillDirs(), ['/host/a', '/plugin/b']);
    assert.equal(resolved.effectiveSkillConfig.externalSkills.defaultExecution, 'worker');
    assert.equal(resolved.effectiveSkillConfig.externalSkills.policy, 'strict');
    assert.deepEqual(resolved.effectiveSkillConfig.skills.demo.config, {
      fromHost: true, value: 2,
    });
    assert.deepEqual(resolved.effectiveSkillConfig.skillsEnabled, { legacy: true });
    host = {
      ...host,
      extraSkillDirs: ['/host/c'],
      skills: {
        demo: { config: { fromHost: 'latest', value: 3 } },
        dynamic: { config: { value: 2 } },
      },
    };
    assert.deepEqual(resolved.resolveCurrentSkillSources().extras, ['/host/c', '/plugin/b']);
    assert.deepEqual(resolved.loadEffectiveSkillConfig().skills.demo.config, {
      fromHost: 'latest', value: 2,
    });

    const { createSkillRuntimeOptions } = await import('../openclaw-plugin/skill-runtime-options.mjs');
    const runtimeOptions = createSkillRuntimeOptions({
      hostVersion: '2.8.5',
      loadEffectiveConfig: resolved.loadEffectiveSkillConfig,
      logger: { info() {}, warn() {}, error() {} },
      requestTimeout: 5,
      serverHost: '127.0.0.1',
      serverPort: 18080,
      trustStore: { inspect() { return {}; } },
    });
    const runtime = runtimeOptions.runtimeFactory({
      descriptor: { id: 'dynamic', capabilities: {} },
    });
    assert.equal(runtime.config.value, 2, 'runtime reads the latest host config');
    await runtime.dispose();
  });

  it('keeps shared server acquisition reference-counted', async () => {
    const { createSharedServerManager } = await import('../openclaw-plugin/shared-server.mjs');
    let createCount = 0;
    let stopCount = 0;
    const manager = createSharedServerManager(() => {
      createCount += 1;
      return {
        async start() {},
        async stop() { stopCount += 1; },
      };
    });

    const first = await manager.acquire({ host: '127.0.0.1', port: 18080 });
    const second = await manager.acquire({ host: '127.0.0.1', port: 18080 });
    assert.equal(first, second);
    assert.equal(createCount, 1);
    assert.equal(manager.refs, 2);

    await manager.release();
    assert.equal(stopCount, 0);
    await manager.release();
    assert.equal(stopCount, 1);
    assert.equal(manager.instance, null);
  });

  it('requires and consumes explicit consent for destructive skill tools', async () => {
    const os = require('os');
    const crypto = require('crypto');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-consent-'));
    try {
      const { createToolPolicy } = await import('../openclaw-plugin/tool-policy.mjs');
      let executions = 0;
      const policy = createToolPolicy({
        api: { logger: { warn() {} } },
        chmodBestEffort() {},
        nodeCrypto: crypto,
        nodeFs: fs,
        nodePath: path,
        runtimePaths: { consentsDir: tempDir },
        security: { toolPolicies: {} },
        sensitiveToolDefaults: [],
      });
      const wrapped = policy.wrapSensitiveTool({
        name: 'example_delete', risk: 'destructive',
        async execute() { executions += 1; return { ok: true }; },
      }, { source: 'test-skill' });
      const first = await wrapped.execute('one', { id: 7 });
      assert.equal(first.structuredContent.code, 'JS_EYES_CONSENT_REQUIRED');
      assert.equal(executions, 0);
      const consentPath = path.join(tempDir, `${first.structuredContent.consentId}.json`);
      const consent = JSON.parse(fs.readFileSync(consentPath, 'utf8'));
      consent.status = 'approved';
      fs.writeFileSync(consentPath, JSON.stringify(consent));
      assert.deepEqual(await wrapped.execute('two', { id: 7 }), { ok: true });
      assert.equal(executions, 1);
      const third = await wrapped.execute('three', { id: 7 });
      assert.equal(third.structuredContent.code, 'JS_EYES_CONSENT_REQUIRED');
      assert.equal(executions, 1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
