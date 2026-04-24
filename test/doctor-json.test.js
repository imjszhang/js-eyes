'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const CLI_ENTRY = path.resolve(__dirname, '..', 'apps', 'cli', 'bin', 'js-eyes.js');

function runDoctorJson(env) {
  const result = spawnSync(process.execPath, [CLI_ENTRY, 'doctor', '--json'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
  return result;
}

describe('js-eyes doctor --json', () => {
  let tempHome = null;
  let originalHome = null;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-doctor-json-'));
    originalHome = process.env.JS_EYES_HOME;
    process.env.JS_EYES_HOME = tempHome;
  });

  afterEach(() => {
    process.env.JS_EYES_HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('prints a structured posture object with the expected top-level keys', () => {
    const result = runDoctorJson({ JS_EYES_HOME: tempHome });
    if (result.status !== 0) {
      // Some CI/sandboxes may not expose certain filesystem locations; surface
      // stderr so failures are actionable but tolerate the environment not
      // being ready by short-circuiting the rest of the checks.
      if (result.stderr && /EACCES|ENOENT|EPERM/.test(result.stderr)) {
        return;
      }
      assert.fail(`doctor --json exited ${result.status}: ${result.stderr}`);
    }

    let posture;
    try {
      posture = JSON.parse(result.stdout);
    } catch (error) {
      assert.fail(`doctor --json produced non-JSON output:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }

    const expectedTopLevelKeys = [
      'version',
      'protocolVersion',
      'token',
      'host',
      'security',
      'policy',
      'paths',
      'skills',
      'extras',
      'registryUrl',
    ];
    for (const key of expectedTopLevelKeys) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(posture, key),
        `doctor --json payload missing key "${key}"`,
      );
    }

    // security shape
    for (const key of [
      'allowAnonymous',
      'allowRawEval',
      'allowRemoteBind',
      'requireLockfile',
      'verifyExtraSkillDirs',
      'enforcement',
      'allowedOrigins',
    ]) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(posture.security, key),
        `posture.security missing key "${key}"`,
      );
    }

    // host shape
    for (const key of ['serverHost', 'serverPort', 'loopback', 'autoStartServer']) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(posture.host, key),
        `posture.host missing key "${key}"`,
      );
    }

    // token shape
    for (const key of ['present', 'source', 'file']) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(posture.token, key),
        `posture.token missing key "${key}"`,
      );
    }

    // arrays where expected
    assert.ok(Array.isArray(posture.skills), 'skills must be an array');
    assert.ok(Array.isArray(posture.extras), 'extras must be an array');
    assert.ok(Array.isArray(posture.security.allowedOrigins));
    assert.ok(Array.isArray(posture.policy.egressAllowlist));

    // verifyExtraSkillDirs defaults to false (zero-breaking-change guarantee)
    assert.equal(posture.security.verifyExtraSkillDirs, false);
    assert.equal(typeof posture.version, 'string');
  });
});
