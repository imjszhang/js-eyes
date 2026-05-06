'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveAutomationToken, getWsConnectOptions, candidateTokenFiles } = require('../lib/wsAuth');

test('resolveAutomationToken prefers explicit token', () => {
  const token = resolveAutomationToken('explicit-token');
  assert.equal(token, 'explicit-token');
});

test('candidateTokenFiles exposes runtime/secrets locations', () => {
  const files = candidateTokenFiles();
  assert.equal(Array.isArray(files), true);
  assert.equal(files.length >= 2, true);
  assert.equal(files.some((entry) => entry.endsWith('runtime\\server.token') || entry.endsWith('runtime/server.token')), true);
});

test('getWsConnectOptions keeps localhost origin header', () => {
  assert.deepEqual(getWsConnectOptions(), { headers: { Origin: 'http://localhost' } });
});
