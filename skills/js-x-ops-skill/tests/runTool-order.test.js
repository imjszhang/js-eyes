'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    buildTryOrder,
    normalizeReadMode,
    FALLBACK_TO_DOM_ERRORS,
} = require('../lib/runTool');

test('normalizeReadMode maps api/graphql/dom/auto', () => {
    assert.equal(normalizeReadMode(undefined), 'auto');
    assert.equal(normalizeReadMode('API'), 'graphql');
    assert.equal(normalizeReadMode('graphql'), 'graphql');
    assert.equal(normalizeReadMode('dom'), 'dom');
});

const baseSearch = {
    methodBase: 'search',
    domSupported: true,
    apiSupported: true,
    defaultReadMode: 'auto',
};

test('buildTryOrder auto: graphql then dom', () => {
    assert.deepEqual(buildTryOrder('search', 'auto', baseSearch), ['api_search', 'dom_search']);
});

test('buildTryOrder graphql: api only when supported', () => {
    assert.deepEqual(buildTryOrder('search', 'graphql', baseSearch), ['api_search', 'search']);
});

test('buildTryOrder dom: dom only', () => {
    assert.deepEqual(buildTryOrder('search', 'dom', baseSearch), ['dom_search']);
});

test('buildTryOrder legacyOnly: single method', () => {
    assert.deepEqual(buildTryOrder('sessionState', 'auto', { legacyOnly: true }), ['sessionState']);
});

test('FALLBACK_TO_DOM_ERRORS has graphql key codes', () => {
    assert.ok(FALLBACK_TO_DOM_ERRORS.has('dom_timeout'));
    assert.ok(FALLBACK_TO_DOM_ERRORS.has('graphql_discovery_failed'));
});

test('fetchAccount pins readMode graphql in source', () => {
    const p = path.join(__dirname, '..', 'lib', 'monitor', 'fetchAccount.js');
    const src = fs.readFileSync(p, 'utf8');
    assert.match(src, /readMode:\s*['"]graphql['"]/);
});
