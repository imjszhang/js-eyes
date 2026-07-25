'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  createSkillEntry,
  createDefinitionEnvelope,
  buildSkillManifest,
} = require('../index');

describe('skill-scaffold', () => {
  it('createSkillEntry binds TOOL_DEFINITIONS to handlers', async () => {
    const entry = createSkillEntry([{
      name: 'demo_tool',
      risk: 'read',
      capabilities: ['browser.tabs.read'],
      async execute(runtime, input) {
        return { ok: true, via: typeof runtime.ensureBot, n: input.n };
      },
    }]);
    const result = await entry.handlers.demo_tool(
      { browser: {}, config: {}, logger: console },
      { n: 1 },
    );
    assert.deepEqual(result, { ok: true, via: 'function', n: 1 });
  });

  it('createDefinitionEnvelope requires SSOT fields', () => {
    const envelope = createDefinitionEnvelope({
      pkg: { name: 'js-demo-ops-skill', version: '1.0.0', description: 'demo' },
      displayName: 'Demo',
      capabilities: {
        browser: ['tabs.read'],
        network: { direct: false, hosts: [] },
        filesystem: ['skillData'],
        process: [],
        secrets: [],
        background: false,
      },
      requirements: {
        server: true,
        browserExtension: true,
        login: false,
        platforms: ['example.com'],
      },
      tools: [{
        name: 'demo_tool',
        risk: 'read',
        capabilities: ['browser.tabs.read'],
        parameters: { type: 'object', properties: {} },
      }],
      extra: { createRuntime: () => ({}) },
    });
    assert.equal(envelope.id, 'js-demo-ops-skill');
    assert.equal(typeof envelope.createRuntime, 'function');
    assert.equal(envelope.TOOL_DEFINITIONS.length, 1);
  });

  it('buildSkillManifest reads an official skill directory', () => {
    const skillDir = path.resolve(__dirname, '../../../skills/js-wechat-ops-skill');
    const manifest = buildSkillManifest(skillDir);
    assert.equal(manifest.manifestVersion, 2);
    assert.equal(manifest.id, 'js-wechat-ops-skill');
    assert.ok(manifest.tools.length >= 1);
    assert.equal(manifest.tools[0].risk, 'read');
  });
});
