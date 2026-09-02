'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  discoverSubSkills,
  prepareSubSkillStage,
} = require('../packages/devtools/lib/build/skills-registry');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');

function officialV2SkillIds() {
  return fs.readdirSync(SKILLS_ROOT)
    .filter((name) => fs.existsSync(path.join(SKILLS_ROOT, name, 'skill.manifest.json')))
    .sort();
}

test('site registry discovers every official V2 skill from static manifests', () => {
  const expected = officialV2SkillIds();
  const discovered = discoverSubSkills();

  assert.equal(expected.length, 12);
  assert.deepEqual(discovered.map((skill) => skill.id).sort(), expected);
  for (const skill of discovered) {
    assert.ok(skill.tools.length > 0, `${skill.id} must publish tools`);
    assert.equal(skill.version, require(path.join(skill.dir, 'package.json')).version);
    assert.ok(Array.isArray(skill.runtime.platforms));
    assert.equal(fs.existsSync(path.join(skill.dir, 'skill.contract.js')), false);
  }
});

test('sub-skill staging vendors every local dependency inside the portable bundle', () => {
  const reddit = discoverSubSkills().find((skill) => skill.id === 'js-reddit-ops-skill');
  const { stageDir, vendored } = prepareSubSkillStage(reddit, { generateLockfile: false });
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(stageDir, 'package.json'), 'utf8'));
    assert.deepEqual(vendored, ['visual-bridge-kit', 'visual-replay-hyperframes']);
    assert.equal(
      pkg.dependencies['@js-eyes/visual-bridge-kit'],
      'file:vendor/visual-bridge-kit',
    );
    assert.equal(
      pkg.dependencies['@js-eyes/visual-replay-hyperframes'],
      'file:vendor/visual-replay-hyperframes',
    );
    assert.ok(fs.existsSync(path.join(stageDir, 'vendor', 'visual-bridge-kit', 'index.js')));
    assert.ok(fs.existsSync(path.join(stageDir, 'vendor', 'visual-replay-hyperframes', 'index.js')));
    assert.equal(
      fs.existsSync(path.join(stageDir, 'vendor', 'visual-replay-hyperframes', '__fixtures__')),
      false,
    );
    assert.equal(fs.existsSync(path.join(stageDir, 'runs')), false);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
});
