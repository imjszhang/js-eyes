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
  it('keeps OpenClaw config discovery out of skill-install and protocol shims', () => {
    const protocolPackage = JSON.parse(read('packages/protocol/package.json'));
    const skillInstallPackage = JSON.parse(read('packages/skill-install/package.json'));
    const skillsImpl = read('packages/skill-install/skills.js');
    const skillsShim = read('packages/protocol/skills.js');

    assert.equal(protocolPackage.files.includes('openclaw-paths.js'), false);
    assert.equal(skillInstallPackage.files?.includes?.('openclaw-paths.js') || false, false);
    for (const skills of [skillsImpl, skillsShim]) {
      assert.doesNotMatch(skills, /OPENCLAW_(CONFIG_PATH|STATE_DIR|HOME)/);
      assert.doesNotMatch(skills, /openclaw\.json/);
      assert.doesNotMatch(skills, /registerOpenClawTools/);
    }
  });

  it('does not let core runtime packages import the OpenClaw plugin', () => {
    for (const relativePath of [
      'packages/skill-install/skills.js',
      'packages/protocol/skills.js',
      'packages/skill-runtime/registry.js',
      'packages/skill-runtime/host-service.js',
      'packages/mcp-server/src/skill-service.js',
    ]) {
      assert.doesNotMatch(read(relativePath), /require\([^)]*openclaw-plugin|from\s+["'][^"']*openclaw-plugin/);
    }
  });

  it('loads the OpenClaw CLI command only when selected', () => {
    const cli = read('apps/cli/src/cli.js');
    assert.doesNotMatch(cli, /^const .*commands\/openclaw/m);
    assert.match(cli, /case 'openclaw':[\s\S]*require\('\.\/commands\/openclaw'\)/);
  });
});
