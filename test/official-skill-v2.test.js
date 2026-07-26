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

test('official V2 entries use skill-scaffold createSkillEntry', () => {
  for (const skillDir of officialSkillDirs()) {
    const source = fs.readFileSync(path.join(skillDir, 'skill.entry.js'), 'utf8');
    assert.match(source, /@js-eyes\/skill-scaffold/);
    assert.match(source, /createSkillEntry/);
    assert.doesNotMatch(source, /legacy-entry|createLegacyHandlers|createRuntime/);
  }
});

test('official skills do not export createOpenClawAdapter and keep TOOL_DEFINITIONS SSOT', () => {
  for (const skillDir of officialSkillDirs()) {
    const definition = require(path.join(skillDir, 'skill.definition.js'));
    assert.equal(typeof definition.createOpenClawAdapter, 'undefined', path.basename(skillDir));
    assert.ok(Array.isArray(definition.TOOL_DEFINITIONS));
    assert.ok(definition.capabilities);
    assert.ok(definition.requirements);
    for (const tool of definition.TOOL_DEFINITIONS) {
      assert.ok(tool.risk, `${definition.id}/${tool.name} risk`);
      assert.ok(Array.isArray(tool.capabilities), `${definition.id}/${tool.name} capabilities`);
    }
  }
});

test('official V2 compatibility is derived from package metadata', () => {
  for (const skillDir of officialSkillDirs()) {
    const pkg = require(path.join(skillDir, 'package.json'));
    const { descriptor } = loadSkillManifest(skillDir);
    assert.equal(pkg.engines.node, '>=22.0.0', pkg.name);
    assert.equal(pkg.jsEyes.minParentVersion, '2.8.5', pkg.name);
    assert.equal(descriptor.compatibility.node, pkg.engines.node, pkg.name);
    assert.equal(
      descriptor.compatibility.jsEyes,
      `>=${pkg.jsEyes.minParentVersion} <3`,
      pkg.name,
    );
  }
});
