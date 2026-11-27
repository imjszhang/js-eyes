'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BROWSER_OPERATIONS,
  CONNECTOR_CAPABILITY_MATRIX,
} = require('../packages/client-sdk/protocol');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');

const CAPABILITY_OPERATIONS = {
  'tabs.read': 'tabs.list',
  'page.read': 'page.html',
  navigation: 'url.open',
  'page.interact': 'page.click',
  'script.execute': 'script.execute',
  screenshot: 'screenshot.capture',
  'cookies.read': 'cookies.read',
};

function browserSkills() {
  return fs.readdirSync(SKILLS_ROOT)
    .filter((name) => fs.existsSync(path.join(SKILLS_ROOT, name, 'skill.manifest.json')))
    .map((name) => ({
      name,
      manifest: require(path.join(SKILLS_ROOT, name, 'skill.manifest.json')),
    }))
    .filter(({ manifest }) => manifest.requirements.browserExtension)
    .sort((a, b) => a.name.localeCompare(b.name));
}

test('official browser skills declare capabilities backed by the protocol operation catalog', () => {
  const skills = browserSkills();
  assert.equal(skills.length, 10);

  const knownOperationIds = new Set(BROWSER_OPERATIONS.map((op) => op.id));
  for (const { name, manifest: skill } of skills) {
    for (const capability of skill.capabilities.browser) {
      const opId = CAPABILITY_OPERATIONS[capability];
      assert.ok(opId, `${name}: unmapped capability ${capability}`);
      assert.equal(knownOperationIds.has(opId), true, `${name}: missing protocol op ${opId}`);
      assert.equal(
        CONNECTOR_CAPABILITY_MATRIX.extension[opId],
        true,
        `${name}: extension connector matrix must support ${opId}`,
      );
    }
  }
});
