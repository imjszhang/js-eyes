'use strict';

/**
 * End-to-end integration test: drive the full "link -> hot-load" path using
 * a tmp JS_EYES_HOME, the real @js-eyes/config IO, and a fake OpenClaw api.
 *
 * This simulates the CLI writing extraSkillDirs and then a `reload()` call
 * (what the chokidar watcher would do) — all without restarting the plugin.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createSkillRegistry } = require('../packages/protocol/skills');
const { loadConfig, setConfigValue } = require('../packages/config');

function writeSkillContract(dir, id, tool) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'),
    JSON.stringify({ name: id, version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(dir, 'skill.contract.js'),
    `module.exports = {
  id: '${id}', name: '${id}', version: '1.0.0',
  openclaw: { tools: [{ name: '${tool}', description: 'x', parameters: { type: 'object', properties: {} } }] },
  createOpenClawAdapter() {
    return {
      runtime: {},
      tools: [{
        name: '${tool}',
        description: 'x',
        parameters: { type: 'object', properties: {} },
        optional: true,
        async execute(tcid, params) {
          return { content: [{ type: 'text', text: 'from ${id}' }] };
        },
      }],
    };
  },
};`, 'utf8');
}

function createFakeApi() {
  const registered = new Map();
  return {
    logger: { info() {}, warn() {}, error() {} },
    _registered: registered,
    registerTool(definition) {
      if (registered.has(definition.name)) {
        throw new Error(`duplicate: ${definition.name}`);
      }
      registered.set(definition.name, definition);
    },
  };
}

describe('integration: link -> hot-load via real config IO', () => {
  let originalHome = null;
  let tmpHome = null;
  let primaryDir = null;

  beforeEach(() => {
    originalHome = process.env.JS_EYES_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-e2e-'));
    process.env.JS_EYES_HOME = tmpHome;
    primaryDir = path.join(tmpHome, 'skills-primary');
    fs.mkdirSync(primaryDir, { recursive: true });
  });
  afterEach(() => {
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
    tmpHome = null;
    if (originalHome === undefined) delete process.env.JS_EYES_HOME;
    else process.env.JS_EYES_HOME = originalHome;
  });

  it('link -> reload hot-loads a new extra skill without re-registering existing tools', async () => {
    writeSkillContract(path.join(primaryDir, 'core'), 'core', 'core_tool');
    setConfigValue('skillsEnabled.core', true);

    const externalDir = path.join(tmpHome, 'external-skill');
    writeSkillContract(externalDir, 'link-ext', 'link_ext_tool');

    const api = createFakeApi();
    const registry = createSkillRegistry({
      api,
      skillsDir: primaryDir,
      extrasProvider: () => {
        const cfg = loadConfig();
        return Array.isArray(cfg.extraSkillDirs) ? cfg.extraSkillDirs : [];
      },
      configLoader: () => loadConfig(),
      setConfigValue: (k, v) => setConfigValue(k, v),
      logger: api.logger,
      suppressSelfWrites: false,
    });

    await registry.init();
    assert.equal(api._registered.size, 1);
    assert.ok(api._registered.has('core_tool'));

    // Simulate `js-eyes skills link <externalDir>`.
    const existing = loadConfig().extraSkillDirs || [];
    setConfigValue('extraSkillDirs', existing.concat(externalDir));

    // Simulate the chokidar watcher firing reload()
    const summary = await registry.reload('config-watch');
    assert.deepEqual(summary.added, ['link-ext']);
    assert.equal(api._registered.size, 2, 'new dispatcher registered for new tool');
    assert.ok(api._registered.has('link_ext_tool'));

    // Invoke the new tool via the dispatcher to verify delegation works.
    const def = api._registered.get('link_ext_tool');
    const out = await def.execute('t', {});
    assert.match(out.content[0].text, /from link-ext/);

    // Existing tool dispatcher should NOT have been re-registered (api.registerTool
    // would throw on duplicate registration — no throw means we didn't re-add).
    const outCore = await api._registered.get('core_tool').execute('t', {});
    assert.match(outCore.content[0].text, /from core/);

    // Simulate unlink
    setConfigValue('extraSkillDirs', []);
    const summary2 = await registry.reload('config-watch');
    assert.deepEqual(summary2.removed, ['link-ext']);

    // After unlink the dispatcher is still registered (no registerTool churn),
    // but calling it reports unavailable.
    const after = await api._registered.get('link_ext_tool').execute('t', {});
    assert.match(after.content[0].text, /not currently loaded/);
  });

  it('disabling a skill via setConfigValue -> reload removes bindings with no dispatcher churn', async () => {
    writeSkillContract(path.join(primaryDir, 'togg'), 'togg', 'togg_tool');
    setConfigValue('skillsEnabled.togg', true);

    const api = createFakeApi();
    const registry = createSkillRegistry({
      api,
      skillsDir: primaryDir,
      extrasProvider: () => [],
      configLoader: () => loadConfig(),
      setConfigValue: (k, v) => setConfigValue(k, v),
      logger: api.logger,
      suppressSelfWrites: false,
    });
    await registry.init();
    assert.ok(api._registered.has('togg_tool'));
    const sizeBefore = api._registered.size;

    setConfigValue('skillsEnabled.togg', false);
    const summary = await registry.reload('config-watch');
    assert.deepEqual(summary.toggledOff, ['togg']);
    assert.equal(api._registered.size, sizeBefore, 'no dispatcher re-registration');

    const out = await api._registered.get('togg_tool').execute('t', {});
    assert.match(out.content[0].text, /not currently loaded/);
  });
});
