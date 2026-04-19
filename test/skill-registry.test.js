'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createSkillRegistry, purgeRequireCacheFor } = require('../packages/protocol/skills');

function writeSkill(dir, id, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: id, version: opts.version || '1.0.0' }, null, 2),
  );
  const tool = opts.tool || `${id.replace(/-/g, '_')}_tool`;
  const extra = opts.extraBody || '';
  const disposeBody = opts.withDispose
    ? `
        // runtime.dispose is invoked during hot-unload
        runtime.dispose = async () => { global.__jsEyesTestDisposeCalls = (global.__jsEyesTestDisposeCalls || 0) + 1; };`
    : '';
  fs.writeFileSync(
    path.join(dir, 'skill.contract.js'),
    `'use strict';
const pkg = require('./package.json');
${extra}
function createOpenClawAdapter(pluginConfig, logger) {
  const runtime = { hello: 'world' };${disposeBody}
  return {
    runtime,
    tools: [{
      name: '${tool}',
      label: '${tool}',
      description: 'test tool',
      parameters: { type: 'object', properties: { msg: { type: 'string' } } },
      optional: true,
      async execute(toolCallId, params) {
        return { content: [{ type: 'text', text: 'from ${id}: ' + (params && params.msg ? params.msg : '') }] };
      },
    }],
  };
}
module.exports = {
  id: '${id}',
  name: '${opts.name || id}',
  version: '${opts.version || '1.0.0'}',
  description: '',
  openclaw: { tools: [{ name: '${tool}', description: 'test', parameters: { type: 'object', properties: {} } }] },
  createOpenClawAdapter,
};
`,
    'utf8',
  );
}

function createFakeApi(overrides = {}) {
  const calls = [];
  const logger = {
    info: (msg) => calls.push(['info', msg]),
    warn: (msg) => calls.push(['warn', msg]),
    error: (msg) => calls.push(['error', msg]),
  };
  const registered = new Map();
  return {
    logger,
    _calls: calls,
    _registered: registered,
    registerTool: overrides.registerTool || ((definition, options) => {
      if (registered.has(definition.name)) {
        throw new Error(`duplicate registerTool: ${definition.name}`);
      }
      registered.set(definition.name, { definition, options });
    }),
  };
}

function stubConfigIo(initialConfig) {
  let config = JSON.parse(JSON.stringify(initialConfig || {}));
  return {
    loader: () => JSON.parse(JSON.stringify(config)),
    setter: (key, value) => {
      const segments = key.split('.');
      let cursor = config;
      while (segments.length > 1) {
        const seg = segments.shift();
        if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
        cursor = cursor[seg];
      }
      cursor[segments[0]] = value;
    },
    snapshot: () => JSON.parse(JSON.stringify(config)),
  };
}

describe('createSkillRegistry — init + dispatcher indirection', () => {
  let tempDir = null;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-reg-'));
  });
  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
    delete global.__jsEyesTestDisposeCalls;
  });

  it('registers one dispatcher per tool name and delegates to current impl', async () => {
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'alpha'), 'alpha', { tool: 'alpha_tool' });

    const api = createFakeApi();
    const io = stubConfigIo({ skillsEnabled: { alpha: true } });
    const registry = createSkillRegistry({
      api,
      skillsDir: primary,
      extrasProvider: () => [],
      configLoader: io.loader,
      setConfigValue: io.setter,
      logger: api.logger,
      builtinToolNames: ['js_eyes_get_tabs'],
      suppressSelfWrites: false,
    });

    await registry.init();

    assert.ok(api._registered.has('alpha_tool'));
    assert.equal(api._registered.size, 1);
    const { definition } = api._registered.get('alpha_tool');
    const result = await definition.execute('t-1', { msg: 'hi' });
    assert.match(result.content[0].text, /from alpha: hi/);

    // Dispatcher is registered only once even after reload.
    await registry.reload('test');
    assert.equal(api._registered.size, 1);
  });

  it('returns unavailable message when binding is absent (after dispose)', async () => {
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'beta'), 'beta', { tool: 'beta_tool' });

    const api = createFakeApi();
    const io = stubConfigIo({ skillsEnabled: { beta: true } });
    const registry = createSkillRegistry({
      api,
      skillsDir: primary,
      extrasProvider: () => [],
      configLoader: io.loader,
      setConfigValue: io.setter,
      logger: api.logger,
      suppressSelfWrites: false,
    });
    await registry.init();

    await registry.disposeSkill('beta');
    const { definition } = api._registered.get('beta_tool');
    const result = await definition.execute('t', {});
    assert.match(result.content[0].text, /not currently loaded/);
  });

  it('applies wrapSensitiveTool to skill tool definitions', async () => {
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'gamma'), 'gamma', { tool: 'gamma_tool' });

    const wrapCalls = [];
    const wrapSensitiveTool = (definition, ctx) => {
      wrapCalls.push({ name: definition.name, ctx });
      const original = definition.execute;
      return {
        ...definition,
        execute: async (toolCallId, params) => {
          const r = await original(toolCallId, params);
          return { content: [{ type: 'text', text: '[wrapped] ' + r.content[0].text }] };
        },
      };
    };

    const api = createFakeApi();
    const io = stubConfigIo({ skillsEnabled: { gamma: true } });
    const registry = createSkillRegistry({
      api,
      skillsDir: primary,
      extrasProvider: () => [],
      configLoader: io.loader,
      setConfigValue: io.setter,
      logger: api.logger,
      wrapSensitiveTool,
      suppressSelfWrites: false,
    });
    await registry.init();

    assert.equal(wrapCalls.length, 1);
    assert.equal(wrapCalls[0].name, 'gamma_tool');
    const { definition } = api._registered.get('gamma_tool');
    const res = await definition.execute('t', {});
    assert.match(res.content[0].text, /\[wrapped\] from gamma/);
  });
});

describe('createSkillRegistry — reload diff and lifecycle', () => {
  let tempDir = null;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-reg-'));
  });
  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
    delete global.__jsEyesTestDisposeCalls;
  });

  it('hot-loads a newly linked extra skill without re-registering tools', async () => {
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'core'), 'core', { tool: 'core_tool' });

    const externalDir = path.join(tempDir, 'external');
    writeSkill(externalDir, 'extern', { tool: 'extern_tool' });

    let extras = [];
    const api = createFakeApi();
    const io = stubConfigIo({ skillsEnabled: { core: true } });
    const registry = createSkillRegistry({
      api,
      skillsDir: primary,
      extrasProvider: () => extras,
      configLoader: io.loader,
      setConfigValue: io.setter,
      logger: api.logger,
      suppressSelfWrites: false,
    });
    await registry.init();
    assert.equal(api._registered.size, 1);
    assert.ok(api._registered.has('core_tool'));

    // Link the external skill; reload should hot-load it.
    extras = [externalDir];
    const summary = await registry.reload('link');
    assert.deepEqual(summary.added, ['extern']);
    assert.equal(api._registered.size, 2);
    assert.ok(api._registered.has('extern_tool'));
    assert.equal(io.snapshot().skillsEnabled.extern, true, 'extras should be default-enabled');
  });

  it('default-enables extras on first discovery but keeps primary opt-in', async () => {
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'pri'), 'pri', { tool: 'pri_tool' });

    const externalDir = path.join(tempDir, 'external');
    writeSkill(externalDir, 'ext', { tool: 'ext_tool' });

    const api = createFakeApi();
    const io = stubConfigIo({ skillsEnabled: {} });
    const registry = createSkillRegistry({
      api,
      skillsDir: primary,
      extrasProvider: () => [externalDir],
      configLoader: io.loader,
      setConfigValue: io.setter,
      logger: api.logger,
      suppressSelfWrites: false,
    });
    await registry.init();

    const snap = io.snapshot();
    assert.equal(snap.skillsEnabled.pri, false, 'primary is opt-in');
    assert.equal(snap.skillsEnabled.ext, true, 'extras default on');
    assert.ok(api._registered.has('ext_tool'));
    assert.ok(!api._registered.has('pri_tool'), 'primary skill pri is disabled by default');
  });

  it('removes bindings when extras directory is unlinked and dispose is called', async () => {
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });

    const externalDir = path.join(tempDir, 'external');
    writeSkill(externalDir, 'drain', { tool: 'drain_tool', withDispose: true });

    let extras = [externalDir];
    const api = createFakeApi();
    const io = stubConfigIo({ skillsEnabled: {} });
    const registry = createSkillRegistry({
      api,
      skillsDir: primary,
      extrasProvider: () => extras,
      configLoader: io.loader,
      setConfigValue: io.setter,
      logger: api.logger,
      suppressSelfWrites: false,
    });
    await registry.init();
    assert.ok(api._registered.has('drain_tool'));

    extras = [];
    const summary = await registry.reload('unlink');
    assert.deepEqual(summary.removed, ['drain']);
    assert.equal(global.__jsEyesTestDisposeCalls, 1, 'runtime.dispose invoked exactly once');

    // Dispatcher still present, but delegates to a missing binding.
    const { definition } = api._registered.get('drain_tool');
    const res = await definition.execute('t', {});
    assert.match(res.content[0].text, /not currently loaded/);
  });

  it('toggles a skill off when skillsEnabled flips to false', async () => {
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'togl'), 'togl', { tool: 'togl_tool' });

    const api = createFakeApi();
    const io = stubConfigIo({ skillsEnabled: { togl: true } });
    const registry = createSkillRegistry({
      api,
      skillsDir: primary,
      extrasProvider: () => [],
      configLoader: io.loader,
      setConfigValue: io.setter,
      logger: api.logger,
      suppressSelfWrites: false,
    });
    await registry.init();
    assert.ok(registry._internals.toolBindings.has('togl_tool'));

    io.setter('skillsEnabled.togl', false);
    const summary = await registry.reload('toggle');
    assert.deepEqual(summary.toggledOff, ['togl']);
    assert.ok(!registry._internals.toolBindings.has('togl_tool'));
  });

  it('serialises concurrent reload() calls', async () => {
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'seq'), 'seq', { tool: 'seq_tool' });

    const api = createFakeApi();
    const io = stubConfigIo({ skillsEnabled: { seq: true } });
    const registry = createSkillRegistry({
      api,
      skillsDir: primary,
      extrasProvider: () => [],
      configLoader: io.loader,
      setConfigValue: io.setter,
      logger: api.logger,
      suppressSelfWrites: false,
    });
    await registry.init();

    const [a, b, c] = await Promise.all([
      registry.reload('a'),
      registry.reload('b'),
      registry.reload('c'),
    ]);
    assert.equal(a, b, 'concurrent reload calls return same in-flight promise result');
    assert.equal(b, c);
  });

  it('logs a warning and keeps other skills loaded when a new tool name registration fails', async () => {
    const primary = path.join(tempDir, 'primary');
    fs.mkdirSync(primary, { recursive: true });
    writeSkill(path.join(primary, 'ok'), 'ok', { tool: 'ok_tool' });

    const externalDir = path.join(tempDir, 'new-ext');
    writeSkill(externalDir, 'newx', { tool: 'new_tool' });

    let extras = [];
    const flaky = createFakeApi({
      registerTool: (() => {
        const store = new Map();
        return (definition) => {
          if (definition.name === 'new_tool') {
            throw new Error('post-boot register not allowed');
          }
          store.set(definition.name, definition);
        };
      })(),
    });

    const io = stubConfigIo({ skillsEnabled: { ok: true } });
    const registry = createSkillRegistry({
      api: flaky,
      skillsDir: primary,
      extrasProvider: () => extras,
      configLoader: io.loader,
      setConfigValue: io.setter,
      logger: flaky.logger,
      suppressSelfWrites: false,
    });
    await registry.init();

    extras = [externalDir];
    const summary = await registry.reload('link');
    assert.ok(summary.failedDispatchers.length >= 1);
    const warning = flaky._calls.find((c) => c[0] === 'warn' && /Failed to register dispatcher/.test(c[1]));
    assert.ok(warning, 'should log a warning');
  });
});

describe('purgeRequireCacheFor', () => {
  let tempDir = null;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-cache-'));
  });
  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it('drops cached modules under skillDir but preserves node_modules', () => {
    const skillDir = fs.realpathSync(fs.mkdirSync(path.join(tempDir, 'skill'), { recursive: true }) ? path.join(tempDir, 'skill') : path.join(tempDir, 'skill'));
    fs.writeFileSync(path.join(skillDir, 'a.js'), 'module.exports = 1;');
    fs.writeFileSync(path.join(skillDir, 'b.js'), 'module.exports = 2;');
    const nm = path.join(skillDir, 'node_modules', 'dep');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, 'index.js'), 'module.exports = 3;');

    const aPath = require.resolve(path.join(skillDir, 'a.js'));
    const bPath = require.resolve(path.join(skillDir, 'b.js'));
    const nmPath = require.resolve(path.join(nm, 'index.js'));
    require(aPath);
    require(bPath);
    require(nmPath);

    const purged = purgeRequireCacheFor(skillDir);
    assert.ok(purged >= 2);
    assert.ok(!require.cache[aPath]);
    assert.ok(!require.cache[bPath]);
    assert.ok(require.cache[nmPath], 'node_modules entries preserved');
  });
});
