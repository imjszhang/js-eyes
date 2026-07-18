'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_REQUEST_TIMEOUT_SEC,
  resolveRequestTimeoutSec,
} = require('../lib/runtimeConfig');

test('DEFAULT_REQUEST_TIMEOUT_SEC is 1800', () => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_SEC, 1800);
});

test('resolveRequestTimeoutSec honors env and CLI override', () => {
  const keys = ['JS_X_OPS_REQUEST_TIMEOUT'];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.env.JS_X_OPS_REQUEST_TIMEOUT = '900';
    assert.equal(resolveRequestTimeoutSec({}), 900);
    assert.equal(resolveRequestTimeoutSec({ requestTimeout: 120 }), 120);
  } finally {
    for (const k of keys) {
      if (old[k] == null) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
});

test('runToolCommand passes timeoutMs and defaultTimeout from request timeout', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'cli', 'index.js'), 'utf8');
  assert.match(src, /timeoutMs:\s*requestTimeoutSec\s*\*\s*1000/);
  assert.match(src, /defaultTimeout:\s*requestTimeoutSec/);
  assert.match(src, /bridgeTimeoutMs:\s*requestTimeoutSec\s*\*\s*1000/);
});
