'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig, parseConfigValue, setConfigValue } = require('@js-eyes/config');
const { COMPATIBILITY_MATRIX, PROTOCOL_VERSION } = require('@js-eyes/protocol');
const protocolPkg = require('@js-eyes/protocol/package.json');
const { getPaths } = require('@js-eyes/runtime-paths');
const { parseArgs, resolveExtensionAsset, getServerOptions } = require('../apps/cli/src/cli');

describe('runtime paths', () => {
  const originalHome = process.env.JS_EYES_HOME;
  let tempHome;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-home-'));
    process.env.JS_EYES_HOME = tempHome;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.JS_EYES_HOME;
    } else {
      process.env.JS_EYES_HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('uses JS_EYES_HOME override for runtime files', () => {
    const paths = getPaths();
    assert.equal(paths.baseDir, tempHome);
    assert.equal(paths.configFile, path.join(tempHome, 'config', 'config.json'));
    assert.equal(paths.downloadsDir, path.join(tempHome, 'downloads'));
  });

  it('loads defaults and persists config updates', () => {
    const initial = loadConfig();
    assert.equal(initial.serverHost, 'localhost');
    assert.equal(initial.serverPort, 18080);

    setConfigValue('serverPort', 19090);
    const next = loadConfig();
    assert.equal(next.serverPort, 19090);
  });
});

describe('config parsing', () => {
  it('parses booleans, numbers, null, and json', () => {
    assert.equal(parseConfigValue('true'), true);
    assert.equal(parseConfigValue('42'), 42);
    assert.equal(parseConfigValue('null'), null);
    assert.deepEqual(parseConfigValue('{"a":1}'), { a: 1 });
    assert.equal(parseConfigValue('hello'), 'hello');
  });
});

describe('protocol compatibility', () => {
  it('exports a compatibility matrix tied to the current protocol', () => {
    assert.equal(COMPATIBILITY_MATRIX.protocolVersion, PROTOCOL_VERSION);
    assert.equal(COMPATIBILITY_MATRIX.cliVersion, protocolPkg.version);
    assert.equal(COMPATIBILITY_MATRIX.openclawPluginVersion, protocolPkg.version);
  });
});

describe('repository layout', () => {
  const repoRoot = path.resolve(__dirname, '..');

  it('keeps runtime entrypoints under packages instead of root compatibility trees', () => {
    assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'openclaw-plugin', 'index.mjs')), true);
    assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'server-core', 'index.js')), true);
    assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'client-sdk', 'index.js')), true);

    assert.equal(fs.existsSync(path.join(repoRoot, 'openclaw-plugin', 'index.mjs')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'server', 'index.js')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'clients', 'js-eyes-client.js')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'cli', 'cli.js')), false);
  });
});

describe('cli helpers', () => {
  it('splits flags and positionals', () => {
    const parsed = parseArgs(['server', 'start', '--foreground', '--port', '19090']);
    assert.deepEqual(parsed.positionals, ['server', 'start']);
    assert.equal(parsed.flags.foreground, true);
    assert.equal(parsed.flags.port, '19090');
  });

  it('resolves extension asset metadata', () => {
    const chrome = resolveExtensionAsset('chrome', '1.2.3');
    const firefox = resolveExtensionAsset('firefox', '1.2.3');

    assert.equal(chrome.filename, 'js-eyes-chrome-v1.2.3.zip');
    assert.equal(firefox.filename, 'js-eyes-firefox-v1.2.3.xpi');
    assert.ok(chrome.url.includes('/v1.2.3/'));
  });

  it('merges config defaults with CLI flags', () => {
    const options = getServerOptions({ host: '127.0.0.1', port: '19090' }, {
      serverHost: 'localhost',
      serverPort: 18080,
    });

    assert.equal(options.host, '127.0.0.1');
    assert.equal(options.port, 19090);
  });
});
