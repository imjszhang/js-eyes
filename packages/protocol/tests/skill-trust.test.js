'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createSkillTrustStore } = require('../skills');

let tempDir;
afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function makeSkill(root, overrides = {}) {
  const skillDir = path.join(root, 'skill');
  fs.mkdirSync(skillDir, { recursive: true });
  return {
    id: '@acme/example',
    skillDir,
    descriptor: {
      id: '@acme/example',
      version: '1.0.0',
      publisher: 'acme',
      capabilities: { browser: ['page.read'] },
      ...overrides,
    },
  };
}

describe('skill trust store', () => {
  it('binds approval to descriptor digest and real source path', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-trust-'));
    const store = createSkillTrustStore({ filePath: path.join(tempDir, 'config', 'skill-trust.json') });
    const skill = makeSkill(tempDir);
    assert.equal(store.inspect(skill).approved, false);
    const approval = store.approve(skill, { executionMode: 'worker' });
    assert.equal(approval.executionMode, 'worker');
    assert.equal(store.inspect(skill).approved, true);

    const expanded = { ...skill, descriptor: {
      ...skill.descriptor,
      capabilities: { browser: ['page.read', 'cookies.read'] },
    } };
    assert.deepEqual(store.inspect(expanded).reason, 'descriptor-changed');
  });

  it('revokes an existing approval', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-trust-'));
    const store = createSkillTrustStore({ filePath: path.join(tempDir, 'trust.json') });
    const skill = makeSkill(tempDir);
    store.approve(skill);
    assert.equal(store.revoke(skill), true);
    assert.equal(store.isApproved(skill), false);
  });

  it('invalidates approval when executable source content changes', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jse-trust-'));
    const store = createSkillTrustStore({ filePath: path.join(tempDir, 'trust.json') });
    const skill = makeSkill(tempDir);
    const entryPath = path.join(skill.skillDir, 'entry.js');
    fs.writeFileSync(entryPath, 'module.exports = 1;\n');
    store.approve(skill);
    assert.equal(store.isApproved(skill), true);
    fs.writeFileSync(entryPath, 'module.exports = 2;\n');
    assert.equal(store.inspect(skill).reason, 'source-content-changed');
  });
});
