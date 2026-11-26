'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('@js-eyes/policy exports', () => {
  it('exposes PolicyContext and deep subpath modules', () => {
    const root = require('../../policy');
    assert.equal(typeof root.PolicyContext, 'function');
    assert.equal(require('../../policy/egress'), require('@js-eyes/client-sdk/policy/egress.js'));
    assert.equal(require('../../policy/taint'), require('@js-eyes/client-sdk/policy/taint.js'));
    assert.equal(require('../../policy/task-origin'), require('@js-eyes/client-sdk/policy/task-origin.js'));
    assert.equal(require('../../policy/origin-utils'), require('@js-eyes/client-sdk/policy/origin-utils.js'));
  });

  it('distinguishes controlled extract from arbitrary eval in policy logs', async () => {
    const events = [];
    const policy = new (require('../../policy').PolicyContext)({
      security: { enforcement: 'off', taint: { enabled: false }, taskOrigin: { enabled: false } },
      audit: { write(event, payload) { events.push({ event, payload }); } },
    });
    await policy.evaluate('extractPage', { tabId: 1, evalKind: 'controlled_extract' });
    await policy.evaluate('executeScript', { tabId: 1, code: '1+1', evalKind: 'arbitrary_eval' });
    const kinds = events
      .filter((item) => item.event === 'policy.allow')
      .map((item) => [item.payload.tool, item.payload.evalKind]);
    assert.deepEqual(kinds, [
      ['extractPage', 'controlled_extract'],
      ['executeScript', 'arbitrary_eval'],
    ]);
  });

  it('defaults egressAllowlist to ["*"] and lets explicit config override to restrict hosts', async () => {
    const { DEFAULT_SECURITY_CONFIG } = require('../../protocol');
    const { mergeSecurityConfig } = require('../../config');
    const { PolicyContext } = require('../../policy');

    assert.deepEqual(DEFAULT_SECURITY_CONFIG.egressAllowlist, ['*']);

    const defaultSecurity = mergeSecurityConfig();
    assert.deepEqual(defaultSecurity.egressAllowlist, ['*']);
    const openPolicy = new PolicyContext({ security: defaultSecurity });
    const openDecision = await openPolicy.evaluate('openUrl', { url: 'https://any.example.org/path' });
    assert.equal(openDecision.decision, 'allow');

    const restrictedSecurity = mergeSecurityConfig({ egressAllowlist: ['allowed.example'] });
    assert.deepEqual(restrictedSecurity.egressAllowlist, ['allowed.example']);
    const restrictedPolicy = new PolicyContext({ security: restrictedSecurity });
    assert.equal(
      (await restrictedPolicy.evaluate('openUrl', { url: 'https://allowed.example/ok' })).decision,
      'allow',
    );
    assert.equal(
      (await restrictedPolicy.evaluate('openUrl', { url: 'https://blocked.example/no' })).decision,
      'pending-egress',
    );

    const emptySecurity = mergeSecurityConfig({ egressAllowlist: [] });
    assert.deepEqual(emptySecurity.egressAllowlist, []);
  });
});
