'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createSkillRegistry,
  discoverLocalSkills,
  resolveSkillSources,
} = require('../skills');

let tempDir;
afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  delete global.__jsEyesV2EntryLoaded;
  delete global.__jsEyesV2Disposed;
});

function writeV2Skill(root, options = {}) {
  const skillDir = path.join(root, options.dirName || 'example-v2');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'package.json'), JSON.stringify({
    name: '@acme/example-v2', version: '1.0.0',
  }));
  fs.writeFileSync(path.join(skillDir, 'skill.manifest.json'), JSON.stringify({
    manifestVersion: 2,
    id: '@acme/example-v2',
    name: 'Example V2',
    version: '1.0.0',
    entry: './entry.js',
    requirements: { platforms: ['example.com'] },
    capabilities: { browser: ['page.read'] },
    tools: [{
      name: 'example_v2_read',
      title: 'Example V2 Read',
      description: 'read data',
      risk: 'read',
      inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
    }],
  }));
  fs.writeFileSync(path.join(skillDir, 'entry.js'), `'use strict';
global.__jsEyesV2EntryLoaded = (global.__jsEyesV2EntryLoaded || 0) + 1;
module.exports = {
  async activate({ runtime }) {
    return {
      handlers: {
        async example_v2_read(ctx, input) {
          return { value: input.value, skillId: ctx.skillId, runtime: !!runtime };
        },
      },
      async dispose() { global.__jsEyesV2Disposed = (global.__jsEyesV2Disposed || 0) + 1; },
    };
  },
};`);
  return skillDir;
}

function configIo(config) {
  return {
    load: () => config,
    set(key, value) {
      const parts = key.split('.');
      let cursor = config;
      while (parts.length > 1) {
        const part = parts.shift();
        cursor[part] ||= {};
        cursor = cursor[part];
      }
      cursor[parts[0]] = value;
    },
  };
}

describe('V2 skill discovery and activation', () => {
  it('discovers static metadata without executing entry code', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-v2-'));
    writeV2Skill(tempDir);
    const skills = discoverLocalSkills(tempDir);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].contractVersion, 2);
    assert.equal(skills[0].id, '@acme/example-v2');
    assert.deepEqual(skills[0].tools, ['example_v2_read']);
    assert.equal(global.__jsEyesV2EntryLoaded, undefined);
  });

  it('isolates malformed manifests during discovery', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-v2-'));
    writeV2Skill(tempDir);
    const badDir = path.join(tempDir, 'bad-v2');
    fs.mkdirSync(badDir);
    fs.writeFileSync(path.join(badDir, 'skill.manifest.json'), '{ broken json');
    const invalid = [];
    const skills = discoverLocalSkills(tempDir, { onInvalid: (item) => invalid.push(item) });
    assert.deepEqual(skills.map((skill) => skill.id), ['@acme/example-v2']);
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0].path, badDir);
  });

  it('classifies a standalone manifest directory as an extra skill source', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-v2-'));
    const skillDir = writeV2Skill(tempDir);
    const sources = resolveSkillSources({ primary: path.join(tempDir, 'primary'), extras: [skillDir] });
    assert.equal(sources.extras[0].kind, 'skill');
  });

  it('activates through the host runtime and returns a host result', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-v2-'));
    writeV2Skill(tempDir);
    const io = configIo({ skillsEnabled: { '@acme/example-v2': true } });
    const fakeRuntime = {
      config: {},
      logger: { info() {}, warn() {}, error() {} },
      async invoke(tool, input, invocation) {
        return tool.execute({
          ...invocation,
          skillId: '@acme/example-v2',
        }, input);
      },
      async dispose() {},
    };
    const registry = createSkillRegistry({
      api: { logger: fakeRuntime.logger, registerTool() {} },
      skillsDir: tempDir,
      configLoader: io.load,
      setConfigValue: io.set,
      extrasProvider: () => [],
      runtimeFactory: () => fakeRuntime,
      suppressSelfWrites: false,
    });
    await registry.init();
    assert.equal(global.__jsEyesV2EntryLoaded, 1);
    const result = await registry.executeAction(
      'skill/@acme/example-v2/example-v2-read',
      'call-1',
      { value: 42 },
    );
    assert.deepEqual(JSON.parse(result.content[0].text), {
      value: 42,
      skillId: '@acme/example-v2',
      runtime: true,
    });
    await registry.disposeAll();
    assert.equal(global.__jsEyesV2Disposed, 1);
  });

  it('hot-reloads when a nested source module changes', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-v2-'));
    const skillDir = writeV2Skill(tempDir);
    fs.writeFileSync(path.join(skillDir, 'value.js'), 'module.exports = { value: 1 };\n');
    fs.writeFileSync(path.join(skillDir, 'entry.js'), `
module.exports = { handlers: {
  example_v2_read: async () => require('./value').value
} };
`);
    const io = configIo({ skillsEnabled: { '@acme/example-v2': true } });
    const fakeRuntime = {
      config: {}, logger: { info() {}, warn() {}, error() {} },
      async invoke(tool, input, invocation) { return tool.execute(invocation, input); },
      async dispose() {},
    };
    const registry = createSkillRegistry({
      api: { logger: fakeRuntime.logger, registerTool() {} },
      skillsDir: tempDir,
      configLoader: io.load,
      setConfigValue: io.set,
      extrasProvider: () => [],
      runtimeFactory: () => fakeRuntime,
      suppressSelfWrites: false,
    });
    await registry.init();
    let result = await registry.executeAction('skill/@acme/example-v2/example-v2-read', 'one', {});
    assert.equal(result.structuredContent.value, 1);

    fs.writeFileSync(path.join(skillDir, 'value.js'), 'module.exports = { value: 2 };\n');
    const summary = await registry.reload('nested-source-change');
    assert.deepEqual(summary.reloaded, ['@acme/example-v2']);
    result = await registry.executeAction('skill/@acme/example-v2/example-v2-read', 'two', {});
    assert.equal(result.structuredContent.value, 2);
    await registry.disposeAll();
  });

  it('does not activate an unapproved external V2 skill under prompt policy', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-v2-'));
    const primary = path.join(tempDir, 'primary');
    const external = writeV2Skill(path.join(tempDir, 'external-parent'));
    fs.mkdirSync(primary, { recursive: true });
    const io = configIo({ skillsEnabled: { '@acme/example-v2': true } });
    let trusted = false;
    const fakeRuntime = {
      config: {}, logger: { info() {}, warn() {}, error() {} },
      async invoke(tool, input, invocation) { return tool.execute(invocation, input); },
      async dispose() {},
    };
    const registry = createSkillRegistry({
      api: { logger: fakeRuntime.logger, registerTool() {} },
      skillsDir: primary,
      extrasProvider: () => [external],
      configLoader: io.load,
      setConfigValue: io.set,
      runtimeFactory: () => fakeRuntime,
      externalSkillPolicy: 'prompt',
      trustChecker: () => trusted,
      suppressSelfWrites: false,
    });
    await registry.init();
    assert.equal(registry.describeSkill('@acme/example-v2'), null);
    trusted = true;
    const summary = await registry.reload('approved');
    assert.deepEqual(summary.added, ['@acme/example-v2']);
    assert.ok(registry.describeSkill('@acme/example-v2'));
    await registry.disposeAll();
  });
});
