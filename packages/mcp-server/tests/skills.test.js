'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { McpSkillService } = require('../src/skill-service');

let tempDir;
let service;
afterEach(async () => {
  if (service) await service.dispose();
  service = null;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('MCP skill router', () => {
  it('lists, describes, and invokes a V2 skill through the shared runtime', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-mcp-skill-'));
    const skillsDir = path.join(tempDir, 'skills');
    const skillDir = path.join(skillsDir, 'example');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'package.json'), JSON.stringify({ name: '@acme/mcp-example', version: '1.0.0' }));
    fs.writeFileSync(path.join(skillDir, 'skill.manifest.json'), JSON.stringify({
      manifestVersion: 2,
      id: '@acme/mcp-example',
      name: 'MCP Example',
      version: '1.0.0',
      entry: './entry.js',
      capabilities: { browser: ['tabs.read'] },
      tools: [{
        name: 'mcp_example_read', title: 'Read', risk: 'read',
        inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      }, {
        name: 'mcp_example_delete', title: 'Delete', risk: 'destructive',
        inputSchema: { type: 'object', properties: {} },
      }],
    }));
    fs.writeFileSync(path.join(skillDir, 'entry.js'), `module.exports = { handlers: {
      async mcp_example_read(ctx, input) { return { value: input.value, source: ctx.source }; },
      async mcp_example_delete() { return { deleted: true }; }
    } };`);
    const config = {
      skillsDir,
      extraSkillDirs: [],
      skillsEnabled: { '@acme/mcp-example': true },
      externalSkills: { policy: 'legacy', defaultExecution: 'worker' },
      serverUrl: 'ws://127.0.0.1:18080',
      requestTimeout: 5,
      recording: { mode: 'off' },
    };
    const session = { getBot() { throw new Error('browser should not be used'); } };
    service = new McpSkillService(config, session, {
      logger: { info() {}, warn() {}, error() {} },
      paths: {
        baseDir: tempDir,
        configDir: path.join(tempDir, 'config'),
        skillsDir,
      },
    });
    const listed = await service.list();
    assert.equal(listed.length, 1);
    const described = await service.describe('@acme/mcp-example');
    assert.equal(described.tools[0].risk, 'read');
    const result = await service.call('@acme/mcp-example', 'mcp_example_read', { value: 42 }, 'call-1');
    assert.deepEqual(result.structuredContent, { value: 42, source: 'mcp' });
    await assert.rejects(
      () => service.call('@acme/mcp-example', 'mcp_example_delete', {}, 'call-2'),
      (error) => error.code === 'SKILL_RISK_DENIED',
    );
  });
});
