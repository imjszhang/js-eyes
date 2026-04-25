'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  snapshotExtraDir,
  verifyExtraDir,
  clearSnapshotForExtraDir,
  classifyExtraDir,
  getSnapshotPath,
} = require('../packages/protocol/extra-integrity');

describe('extra-integrity snapshot + verify', () => {
  let tempHome = null;
  let extraDir = null;
  let originalEnv;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-extra-home-'));
    extraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-extra-src-'));
    originalEnv = process.env.JS_EYES_HOME;
    process.env.JS_EYES_HOME = tempHome;

    fs.writeFileSync(path.join(extraDir, 'alpha.js'), 'module.exports = 1;');
    fs.mkdirSync(path.join(extraDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(extraDir, 'nested', 'beta.js'), 'module.exports = 2;');
  });

  afterEach(() => {
    process.env.JS_EYES_HOME = originalEnv;
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(extraDir, { recursive: true, force: true });
  });

  it('snapshot stores file map under ~/.js-eyes/state/extras/', () => {
    const { snapshot, snapshotPath } = snapshotExtraDir(extraDir);
    assert.ok(snapshotPath.includes(path.join('state', 'extras')));
    assert.ok(snapshotPath.startsWith(tempHome));
    assert.equal(snapshot.path, path.resolve(extraDir));
    assert.ok(snapshot.files['alpha.js'], 'alpha.js should be snapshotted');
    assert.ok(snapshot.files['nested/beta.js'], 'nested/beta.js should be snapshotted');
  });

  it('verify returns ok when files are unchanged', () => {
    snapshotExtraDir(extraDir);
    const result = verifyExtraDir(extraDir);
    assert.equal(result.ok, true);
    assert.equal(result.hasSnapshot, true);
    assert.deepEqual(result.drifted, []);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.extra, []);
  });

  it('verify reports drift when a file is modified', () => {
    snapshotExtraDir(extraDir);
    fs.writeFileSync(path.join(extraDir, 'alpha.js'), 'module.exports = 42;');
    const result = verifyExtraDir(extraDir);
    assert.equal(result.ok, false);
    assert.deepEqual(result.drifted, ['alpha.js']);
  });

  it('verify reports missing when a file is deleted', () => {
    snapshotExtraDir(extraDir);
    fs.rmSync(path.join(extraDir, 'nested', 'beta.js'));
    const result = verifyExtraDir(extraDir);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['nested/beta.js']);
  });

  it('verify reports extras when a new file is added', () => {
    snapshotExtraDir(extraDir);
    fs.writeFileSync(path.join(extraDir, 'gamma.js'), 'module.exports = 3;');
    const result = verifyExtraDir(extraDir);
    assert.equal(result.ok, false);
    assert.deepEqual(result.extra, ['gamma.js']);
  });

  it('verify returns hasSnapshot=false when no snapshot was taken', () => {
    const result = verifyExtraDir(extraDir);
    assert.equal(result.ok, false);
    assert.equal(result.hasSnapshot, false);
  });

  it('clearSnapshotForExtraDir removes the snapshot file', () => {
    const { snapshotPath } = snapshotExtraDir(extraDir);
    assert.ok(fs.existsSync(snapshotPath));
    const removed = clearSnapshotForExtraDir(extraDir);
    assert.equal(removed, true);
    assert.equal(fs.existsSync(snapshotPath), false);
    const result = verifyExtraDir(extraDir);
    assert.equal(result.hasSnapshot, false);
  });

  it('re-snapshot restores verified state after relink', () => {
    snapshotExtraDir(extraDir);
    fs.writeFileSync(path.join(extraDir, 'alpha.js'), 'module.exports = 999;');
    assert.equal(verifyExtraDir(extraDir).ok, false);
    snapshotExtraDir(extraDir);
    assert.equal(verifyExtraDir(extraDir).ok, true);
  });

  it('classifyExtraDir returns off when not enabled', () => {
    snapshotExtraDir(extraDir);
    assert.equal(classifyExtraDir(extraDir, { enabled: false }).state, 'off');
  });

  it('classifyExtraDir returns verified / drifted / missing-snapshot when enabled', () => {
    assert.equal(classifyExtraDir(extraDir, { enabled: true }).state, 'missing-snapshot');
    snapshotExtraDir(extraDir);
    assert.equal(classifyExtraDir(extraDir, { enabled: true }).state, 'verified');
    fs.writeFileSync(path.join(extraDir, 'alpha.js'), 'module.exports = 999;');
    assert.equal(classifyExtraDir(extraDir, { enabled: true }).state, 'drifted');
  });

  it('snapshot paths are per-abs-path, so two dirs do not collide', () => {
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-extra-src-'));
    try {
      fs.writeFileSync(path.join(second, 'x.js'), 'x');
      const a = getSnapshotPath(extraDir);
      const b = getSnapshotPath(second);
      assert.notEqual(a, b);
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }
  });
});
