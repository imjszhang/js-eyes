'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWED_SUBCOMMANDS,
  SAFE_ENV_KEYS,
  buildSafeEnv,
} = require('../packages/protocol/safe-npm');

describe('safe-npm allowlists', () => {
  it('ALLOWED_SUBCOMMANDS contains exactly ci and install', () => {
    assert.deepEqual(Object.keys(ALLOWED_SUBCOMMANDS).sort(), ['ci', 'install']);
  });

  it('ALLOWED_SUBCOMMANDS arrays and wrapper are frozen', () => {
    assert.ok(Object.isFrozen(ALLOWED_SUBCOMMANDS));
    assert.ok(Object.isFrozen(ALLOWED_SUBCOMMANDS.ci));
    assert.ok(Object.isFrozen(ALLOWED_SUBCOMMANDS.install));
  });

  it('ALLOWED_SUBCOMMANDS argv entries are constant strings with --no-audit and --no-fund', () => {
    for (const subcommand of Object.keys(ALLOWED_SUBCOMMANDS)) {
      const args = ALLOWED_SUBCOMMANDS[subcommand];
      assert.equal(args[0], subcommand);
      assert.ok(args.includes('--no-audit'));
      assert.ok(args.includes('--no-fund'));
      for (const arg of args) {
        assert.equal(typeof arg, 'string');
        assert.ok(arg.length > 0);
      }
    }
  });
});

describe('safe-npm env construction', () => {
  it('buildSafeEnv only transfers whitelisted keys and npm_config_*', () => {
    const src = {
      PATH: '/usr/bin',
      HOME: '/home/me',
      JS_EYES_SERVER_TOKEN: 'should-be-dropped',
      AWS_SECRET_ACCESS_KEY: 'should-be-dropped',
      OAUTH_REFRESH_TOKEN: 'should-be-dropped',
      npm_config_registry: 'https://registry.example.com',
      npm_config_ignore_scripts: 'true',
      UNRELATED: 'x',
    };
    const result = buildSafeEnv(src);
    assert.equal(result.PATH, '/usr/bin');
    assert.equal(result.HOME, '/home/me');
    assert.equal(result.npm_config_registry, 'https://registry.example.com');
    assert.equal(result.npm_config_ignore_scripts, 'true');
    assert.equal(result.JS_EYES_SERVER_TOKEN, undefined);
    assert.equal(result.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(result.OAUTH_REFRESH_TOKEN, undefined);
    assert.equal(result.UNRELATED, undefined);
  });

  it('buildSafeEnv extras override source values', () => {
    const src = { PATH: '/usr/bin', npm_config_ignore_scripts: 'false' };
    const result = buildSafeEnv(src, { npm_config_ignore_scripts: 'true' });
    assert.equal(result.npm_config_ignore_scripts, 'true');
  });

  it('SAFE_ENV_KEYS includes the essentials needed on Windows and POSIX', () => {
    for (const key of ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'TEMP', 'TMP']) {
      assert.ok(SAFE_ENV_KEYS.includes(key), `expected ${key} in SAFE_ENV_KEYS`);
    }
  });
});

describe('safe-npm rejects calls outside the allowlist', () => {
  it('exported runNpm-backed helpers never accept arbitrary subcommands', () => {
    const mod = require('../packages/protocol/safe-npm');
    assert.equal(typeof mod.safeNpmCi, 'function');
    assert.equal(typeof mod.safeNpmInstall, 'function');
    assert.equal(mod.runAnything, undefined);
    assert.equal(mod.exec, undefined);
  });
});
