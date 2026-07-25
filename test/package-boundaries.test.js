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
  it('protocol does not depend on skill-install and has no install shims', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'packages/protocol/package.json'), 'utf8'),
    );
    assert.equal(pkg.dependencies?.['@js-eyes/skill-install'], undefined);
    assert.equal(pkg.files.includes('skills.js'), false);
    for (const name of REMOVED_PROTOCOL_SHIMS) {
      assert.equal(
        fs.existsSync(path.join(repoRoot, 'packages/protocol', name)),
        false,
        `expected packages/protocol/${name} to be removed`,
      );
      assert.equal(pkg.files.includes(name), false, `files must not list ${name}`);
    }
  });

  it('client-sdk no longer ships a policy/ compatibility directory', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'packages/client-sdk/package.json'), 'utf8'),
    );
    assert.equal(pkg.files.includes('policy/'), false);
    assert.equal(
      fs.existsSync(path.join(repoRoot, 'packages/client-sdk/policy')),
      false,
    );
    const index = fs.readFileSync(
      path.join(repoRoot, 'packages/client-sdk/index.js'),
      'utf8',
    );
    assert.match(index, /require\(['"]@js-eyes\/policy['"]\)/);
    assert.doesNotMatch(index, /require\(['"]\.\/policy['"]\)/);
  });
});
