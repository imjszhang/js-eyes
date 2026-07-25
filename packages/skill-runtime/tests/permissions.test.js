'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  capabilityAllowed,
  createSkillPermissionPolicy,
} = require('../permissions');

describe('Skill host permission policy', () => {
  it('supports exact and namespace capability grants', () => {
    assert.equal(capabilityAllowed('browser.page.read', new Set(['browser.page.read'])), true);
    assert.equal(capabilityAllowed('browser.page.read', new Set(['browser.*'])), true);
    assert.equal(capabilityAllowed('browser.script.execute', new Set(['browser.page.read'])), false);
  });

  it('intersects risk and capability profiles', async () => {
    const safe = createSkillPermissionPolicy({
      source: 'mcp',
      allowedRisks: ['read'],
      allowedCapabilities: [
        'browser.tabs.read',
        'browser.page.read',
        'browser.navigation',
        'browser.screenshot',
        'network.direct',
        'network.host:*',
        'filesystem.skillData',
      ],
    });

    await safe.assert({
      risk: 'read',
      capabilities: ['browser.page.read'],
    });
    await assert.rejects(
      safe.assert({ risk: 'interactive', capabilities: [] }),
      (error) => error.code === 'SKILL_RISK_DENIED',
    );
    await assert.rejects(
      safe.assert({ risk: 'read', capabilities: ['browser.script.execute'] }),
      (error) => error.code === 'SKILL_CAPABILITY_DENIED',
    );
  });

  it('runs an optional host authorization hook after static checks', async () => {
    const calls = [];
    const policy = createSkillPermissionPolicy({
      authorize(invocation) {
        calls.push(invocation.toolName);
      },
    });
    await policy.assert({ toolName: 'example', risk: 'read', capabilities: [] });
    assert.deepEqual(calls, ['example']);
  });
});
