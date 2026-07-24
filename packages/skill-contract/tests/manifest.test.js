'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ManifestValidationError,
  checkCompatibility,
  loadSkillManifest,
  normalizeV1Contract,
  normalizeV2Contract,
  validateSkillManifest,
} = require('..');

let tempDir;
afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function manifest(overrides = {}) {
  return {
    manifestVersion: 2,
    id: '@acme/example',
    name: 'Example',
    version: '1.0.0',
    entry: './entry.js',
    requirements: { platforms: ['example.com'] },
    capabilities: { browser: ['page.read'] },
    tools: [{
      name: 'example_read',
      title: 'Example Read',
      description: 'read example',
      risk: 'read',
      capabilities: ['browser.page.read'],
      inputSchema: { type: 'object', properties: {} },
    }],
    ...overrides,
  };
}

describe('skill manifest', () => {
  it('normalizes a static V2 manifest without executing the entry', () => {
    const value = validateSkillManifest(manifest());
    assert.equal(value.id, '@acme/example');
    assert.equal(value.tools[0].risk, 'read');
    assert.deepEqual(value.requirements.platforms, ['example.com']);
  });

  it('rejects duplicate tools and invalid risk values', () => {
    assert.throws(
      () => validateSkillManifest(manifest({ tools: [manifest().tools[0], manifest().tools[0]] })),
      ManifestValidationError,
    );
    assert.throws(
      () => validateSkillManifest(manifest({ tools: [{ ...manifest().tools[0], risk: 'unknown' }] })),
      ManifestValidationError,
    );
  });

  it('loads JSON without requiring the executable entry', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-contract-'));
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      name: '@acme/example', version: '1.0.0',
    }));
    fs.writeFileSync(path.join(tempDir, 'skill.manifest.json'), JSON.stringify(manifest()));
    fs.writeFileSync(path.join(tempDir, 'entry.js'), 'throw new Error("entry executed")');

    const loaded = loadSkillManifest(tempDir);
    assert.equal(loaded.descriptor.id, '@acme/example');
    assert.equal(loaded.entryPath, fs.realpathSync(path.join(tempDir, 'entry.js')));
  });

  it('rejects entries outside the skill root', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-contract-'));
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      name: '@acme/example', version: '1.0.0',
    }));
    fs.writeFileSync(path.join(tempDir, 'skill.manifest.json'), JSON.stringify(manifest({ entry: '../entry.js' })));
    assert.throws(() => loadSkillManifest(tempDir), ManifestValidationError);
  });

  it('rejects CLI entries outside the skill root', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-contract-'));
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      name: '@acme/example', version: '1.0.0',
    }));
    fs.writeFileSync(path.join(tempDir, 'entry.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(tempDir, 'skill.manifest.json'), JSON.stringify(manifest({
      cli: { entry: '../outside.js', commands: [] },
    })));
    assert.throws(() => loadSkillManifest(tempDir), ManifestValidationError);
  });
});

describe('contract normalization', () => {
  it('preserves V1 host results and risk metadata', async () => {
    const definition = normalizeV1Contract({
      id: 'legacy',
      version: '1.0.0',
      createOpenClawAdapter() {
        return {
          runtime: { dispose() {} },
          tools: [{
            name: 'legacy_write',
            label: 'Legacy Write',
            description: 'write',
            parameters: { type: 'object', properties: {} },
            optional: true,
            destructive: true,
            async execute(toolCallId) {
              return { content: [{ type: 'text', text: toolCallId }] };
            },
          }],
        };
      },
    });
    assert.equal(definition.tools[0].risk, 'destructive');
    assert.equal(definition.tools[0].resultMode, 'host');
    const result = await definition.tools[0].execute({ toolCallId: 'call-1' }, {});
    assert.equal(result.content[0].text, 'call-1');
  });

  it('binds V2 manifest metadata to entry handlers', async () => {
    const descriptor = validateSkillManifest(manifest({ tools: [{
      ...manifest().tools[0],
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
      },
    }] }));
    const definition = normalizeV2Contract(descriptor, {
      example_read: async (_ctx, input) => ({ value: input.value }),
    });
    assert.equal(definition.contractVersion, 2);
    assert.deepEqual(await definition.tools[0].execute({}, { value: 42 }), { value: 42 });
    await assert.rejects(
      () => definition.tools[0].execute({}, { value: 'wrong' }),
      (error) => error.code === 'SKILL_INPUT_INVALID' && error.safeDetails.toolName === 'example_read',
    );
  });
});

describe('compatibility', () => {
  it('checks caret and comparator ranges', () => {
    assert.equal(checkCompatibility({
      jsEyes: '>=2.8.0 <3.0.0',
      runtimeApi: '^2.0.0',
      node: '>=22',
    }, {
      jsEyes: '2.8.5', runtimeApi: '2.1.0', node: '22.20.0',
    }).compatible, true);
    const result = checkCompatibility({ runtimeApi: '^3.0.0' }, { runtimeApi: '2.1.0' });
    assert.equal(result.compatible, false);
    assert.equal(result.failures[0].name, 'runtimeApi');
  });
});
