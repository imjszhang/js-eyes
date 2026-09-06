'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('@js-eyes/policy exports', () => {
  it('exposes PolicyContext and deep subpath modules', () => {
    const root = require('..');
    assert.equal(typeof root.PolicyContext, 'function');
    assert.equal(require('../egress'), require('@js-eyes/policy/egress.js'));
    assert.equal(require('../taint'), require('@js-eyes/policy/taint.js'));
    assert.equal(require('../task-origin'), require('@js-eyes/policy/task-origin.js'));
    assert.equal(require('../origin-utils'), require('@js-eyes/policy/origin-utils.js'));
  });

  it('distinguishes controlled extract from arbitrary eval in policy logs', async () => {
    const events = [];
    const policy = new (require('..').PolicyContext)({
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
});
