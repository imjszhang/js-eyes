'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { CANONICAL_REPOSITORY_URL, RELEASE_PACKAGES } = require('../scripts/release-packages');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('controlled release contract', () => {
  it('publishes the seven runtime workspaces followed by the public CLI', () => {
    assert.equal(RELEASE_PACKAGES.length, 8);
    assert.deepEqual(RELEASE_PACKAGES.slice(-2).map((entry) => entry.name), [
      '@js-eyes/native-host',
      'js-eyes',
    ]);
    for (const entry of RELEASE_PACKAGES) {
      const manifest = JSON.parse(read(`${entry.dir}/package.json`));
      assert.equal(manifest.name, entry.name);
      assert.equal(manifest.repository.url, CANONICAL_REPOSITORY_URL);
    }
  });

  it('keeps real npm publishing behind OIDC and the protected environment', () => {
    const workflow = read('.github/workflows/release-publish.yml');
    assert.match(workflow, /^ {2}workflow_dispatch:/m);
    assert.match(workflow, /environment: release-production/);
    assert.match(workflow, /id-token: write/);
    assert.match(workflow, /node-version: 24/);
    assert.match(workflow, /npm@11\.5\.1/);
    assert.doesNotMatch(workflow, /NPM_TOKEN|npm_key/);
  });

  it('keeps verification free of signing and publishing credentials', () => {
    const workflow = read('.github/workflows/release-verify.yml');
    assert.match(workflow, /build:firefox:dev/);
    assert.match(workflow, /release:prepare-packages/);
    assert.doesNotMatch(workflow, /AMO_API_SECRET|NPM_TOKEN|npm publish/);
  });

  it('refuses a mismatched explicitly confirmed version', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/verify-release.js'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, EXPECTED_VERSION: '0.0.0' },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /confirmed version 0\.0\.0/);
  });

  it('uses argument-based Firefox signing and keeps normal builds unsigned', () => {
    const builder = read('packages/devtools/lib/build/extensions.js');
    const pkg = JSON.parse(read('package.json'));
    assert.match(builder, /execFileSync\('web-ext', args/);
    assert.doesNotMatch(builder, /execSync\(cmd, \{ cwd: FIREFOX_DIR/);
    assert.match(pkg.scripts.build, /--no-sign/);
  });
});
