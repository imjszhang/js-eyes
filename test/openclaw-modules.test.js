'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const pluginRoot = path.join(repoRoot, 'openclaw-plugin');

describe('OpenClaw module boundaries', () => {
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
      'registration-context.mjs',
      'server-service.mjs',
      'shared-server.mjs',
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
});
