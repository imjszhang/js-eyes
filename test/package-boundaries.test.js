'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');

const REMOVED_PROTOCOL_SHIMS = Object.freeze([
  'skills.js',
  'zip-extract.js',
  'fs-io.js',
  'safe-npm.js',
  'extra-integrity.js',
  'skill-trust.js',
  'skill-runner.js',
  'registry-client.js',
]);

describe('package boundary cleanup', () => {
  it('protocol module inside client-sdk has no skill-install shims', () => {
    for (const name of REMOVED_PROTOCOL_SHIMS) {
      assert.equal(
        fs.existsSync(path.join(repoRoot, 'packages/client-sdk/protocol', name)),
        false,
        `expected packages/client-sdk/protocol/${name} to be absent`,
      );
    }
  });

  it('client-sdk keeps policy isolated in its own submodule and exposes clean subpaths', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'packages/client-sdk/package.json'), 'utf8'),
    );
    assert.equal(pkg.exports['.'], './index.js');
    assert.equal(pkg.exports['./policy'], './policy/index.js');
    assert.equal(pkg.exports['./protocol'], './protocol/index.js');
    assert.equal(pkg.exports['./skill-runtime'], './skill-runtime/index.js');
    assert.equal(
      fs.existsSync(path.join(repoRoot, 'packages/client-sdk/policy/index.js')),
      true,
    );
  });

  it('js-eyes exposes CLI, MCP binary, and server/native-host/mcp subpaths', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'apps/cli/package.json'), 'utf8'),
    );
    assert.equal(pkg.bin['js-eyes'], 'bin/js-eyes.js');
    assert.equal(pkg.bin['js-eyes-mcp'], 'bin/js-eyes-mcp.js');
    assert.equal(pkg.exports['./server-core'], './server-core/index.js');
    assert.equal(pkg.exports['./native-host'], './native-host/src/index.js');
    assert.equal(pkg.exports['./mcp-server'], './mcp-server/index.js');
  });
});
