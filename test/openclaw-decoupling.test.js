'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('OpenClaw integration boundary', () => {
  it('keeps OpenClaw config discovery out of skill-install', () => {
    const protocolPackage = JSON.parse(read('packages/protocol/package.json'));
    const skillInstallPackage = JSON.parse(read('packages/skill-install/package.json'));
    const skillsImpl = read('packages/skill-install/skills.js');

    assert.equal(protocolPackage.files.includes('openclaw-paths.js'), false);
    assert.equal(skillInstallPackage.files?.includes?.('openclaw-paths.js') || false, false);
    assert.doesNotMatch(skillsImpl, /OPENCLAW_(CONFIG_PATH|STATE_DIR|HOME)/);
    assert.doesNotMatch(skillsImpl, /openclaw\.json/);
    assert.doesNotMatch(skillsImpl, /registerOpenClawTools/);
  });

  it('does not let core runtime packages import the OpenClaw plugin', () => {
    for (const relativePath of [
      'packages/skill-install/skills.js',
      'packages/skill-runtime/registry.js',
      'packages/skill-runtime/host-service.js',
      'packages/mcp-server/src/skill-service.js',
      'packages/server-core/index.js',
      'packages/client-sdk/index.js',
      'packages/policy/index.js',
    ]) {
      if (!fs.existsSync(path.join(repoRoot, relativePath))) continue;
      assert.doesNotMatch(read(relativePath), /require\([^)]*openclaw-plugin|from\s+["'][^"']*openclaw-plugin/);
    }
  });

  it('keeps OpenClaw server lifecycle and skills admin outside core packages', () => {
    assert.equal(fs.existsSync(path.join(repoRoot, 'openclaw-plugin/server-lifecycle.mjs')), true);
    assert.equal(fs.existsSync(path.join(repoRoot, 'openclaw-plugin/skills-admin.mjs')), true);
    for (const relativePath of [
      'packages/skill-install/skills.js',
      'packages/skill-runtime/host-service.js',
      'packages/server-core/index.js',
    ]) {
      if (!fs.existsSync(path.join(repoRoot, relativePath))) continue;
      const source = read(relativePath);
      assert.doesNotMatch(source, /server-lifecycle/);
      assert.doesNotMatch(source, /skills-admin/);
    }
  });

  it('loads the OpenClaw CLI command only when selected', () => {
    const cli = read('apps/cli/src/cli.js');
    assert.doesNotMatch(cli, /^const .*commands\/openclaw/m);
    assert.match(cli, /case 'openclaw':[\s\S]*require\('\.\/commands\/openclaw'\)/);
  });
});
