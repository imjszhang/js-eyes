'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { SkillHostService } = require('../host-service');

describe('SkillHostService', () => {
  it('generates a unique invocation id for concurrent calls without a host id', async () => {
    const service = Object.create(SkillHostService.prototype);
    service.allowedRisks = new Set(['read']);
    service.invocationSource = 'mcp';
    const invocationIds = [];
    service.ensureReady = async () => ({
      describeSkill() {
        return {
          tools: [{ name: 'read', risk: 'read', action: 'skill/demo/read' }],
        };
      },
      executeAction(_action, invocationId) {
        invocationIds.push(invocationId);
        return invocationId;
      },
    });

    await Promise.all(Array.from(
      { length: 50 },
      () => service.call('demo', 'read', {}),
    ));

    assert.equal(invocationIds.length, 50);
    assert.equal(new Set(invocationIds).size, 50);
    assert.ok(invocationIds.every((id) => id.startsWith('mcp-')));
  });

  it('preserves an invocation id supplied by the host', async () => {
    const service = Object.create(SkillHostService.prototype);
    service.allowedRisks = new Set(['read']);
    service.invocationSource = 'mcp';
    service.ensureReady = async () => ({
      describeSkill() {
        return {
          tools: [{ name: 'read', risk: 'read', action: 'skill/demo/read' }],
        };
      },
      executeAction(_action, invocationId) {
        return invocationId;
      },
    });

    assert.equal(
      await service.call('demo', 'read', {}, 'host-call-1'),
      'host-call-1',
    );
  });
});
