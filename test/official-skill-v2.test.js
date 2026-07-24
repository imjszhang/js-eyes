'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { loadSkillManifest } = require('@js-eyes/skill-contract');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');

function officialSkillDirs() {
  return fs.readdirSync(SKILLS_ROOT)
    .map((name) => path.join(SKILLS_ROOT, name))
    .filter((dir) => fs.existsSync(path.join(dir, 'skill.contract.js')))
    .sort();
}

test('every official skill exposes a complete static V2 manifest and entry', () => {
  const dirs = officialSkillDirs();
  assert.ok(dirs.length > 0);
  for (const skillDir of dirs) {
    const { descriptor, entryPath } = loadSkillManifest(skillDir);
    const entry = require(entryPath);
    assert.equal(descriptor.manifestVersion, 2);
    assert.ok(descriptor.tools.length > 0, `${descriptor.id} must declare tools`);
    for (const tool of descriptor.tools) {
      assert.equal(typeof entry.handlers?.[tool.name], 'function', `${descriptor.id}/${tool.name}`);
      assert.ok(['read', 'interactive', 'destructive', 'administrative'].includes(tool.risk));
    }
  }
});

test('official browser skills use the shared client SDK compatibility shim', () => {
  for (const skillDir of officialSkillDirs()) {
    const shim = path.join(skillDir, 'lib', 'js-eyes-client.js');
    if (!fs.existsSync(shim)) continue;
    const source = fs.readFileSync(shim, 'utf8');
    assert.match(source, /require\(['"]@js-eyes\/client-sdk['"]\)/);
    assert.doesNotMatch(source, /class BrowserAutomation/);
  }
});
