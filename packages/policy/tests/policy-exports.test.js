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
});
