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
    .filter((dir) => fs.existsSync(path.join(dir, 'skill.manifest.json')))
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

test('official V2 entries do not use the legacy-entry adapter', () => {
  for (const skillDir of officialSkillDirs()) {
    const source = fs.readFileSync(path.join(skillDir, 'skill.entry.js'), 'utf8');
    assert.match(source, /createNativeHandlers/);
    assert.doesNotMatch(source, /legacy-entry|createLegacyHandlers|createRuntime/);
  }
});
