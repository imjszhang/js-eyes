'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig, parseConfigValue, setConfigValue } = require('@js-eyes/config');
const { COMPATIBILITY_MATRIX, PROTOCOL_VERSION } = require('@js-eyes/protocol');
const { discoverLocalSkills, normalizeSkillMetadata, runSkillCli } = require('@js-eyes/protocol/skills');
const protocolPkg = require('@js-eyes/protocol/package.json');
const { getYtDlpCommand: getBilibiliYtDlpCommand } = require('../skills/js-bilibili-ops-skill/lib/bilibiliUtils');
const { getYtDlpCommand: getYoutubeYtDlpCommand } = require('../skills/js-youtube-ops-skill/lib/youtubeUtils');
const { ensureRuntimePaths, getPaths, resolveLegacyBaseDir } = require('@js-eyes/runtime-paths');
const { parseArgs, resolveExtensionAsset, getServerOptions, flagsToArgv } = require('../apps/cli/src/cli');

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
    assert.equal(paths.skillsDir, path.join(tempHome, 'skills'));
  });

  it('uses ~/.js-eyes as the default runtime directory when not overridden', () => {
    delete process.env.JS_EYES_HOME;
    const paths = getPaths({ home: tempHome });
    assert.equal(paths.baseDir, path.join(tempHome, '.js-eyes'));
    assert.equal(paths.configFile, path.join(tempHome, '.js-eyes', 'config', 'config.json'));
  });

  it('migrates legacy macOS runtime data into ~/.js-eyes', () => {
    delete process.env.JS_EYES_HOME;
    const legacyBaseDir = resolveLegacyBaseDir('darwin', tempHome);
    fs.mkdirSync(path.join(legacyBaseDir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(legacyBaseDir, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(legacyBaseDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(legacyBaseDir, 'config', 'config.json'), '{"serverPort":19090}\n');
    fs.writeFileSync(path.join(legacyBaseDir, 'runtime', 'server.pid'), '12345\n');
    fs.writeFileSync(path.join(legacyBaseDir, 'logs', 'server.log'), 'legacy log\n');

    const paths = ensureRuntimePaths({ home: tempHome, platform: 'darwin' });
    assert.equal(fs.readFileSync(paths.configFile, 'utf8'), '{"serverPort":19090}\n');
    assert.equal(fs.readFileSync(paths.pidFile, 'utf8'), '12345\n');
    assert.equal(fs.readFileSync(paths.serverLogFile, 'utf8'), 'legacy log\n');
    assert.equal(fs.existsSync(legacyBaseDir), false);
  });

  it('migrates legacy Linux runtime data into ~/.js-eyes', () => {
    delete process.env.JS_EYES_HOME;
    const env = { XDG_CONFIG_HOME: path.join(tempHome, '.config-root') };
    const legacyBaseDir = resolveLegacyBaseDir('linux', tempHome, env);
    fs.mkdirSync(path.join(legacyBaseDir, 'downloads'), { recursive: true });
    fs.writeFileSync(path.join(legacyBaseDir, 'downloads', 'chrome.zip'), 'zip');

    const paths = ensureRuntimePaths({ home: tempHome, platform: 'linux', env });
    assert.equal(fs.readFileSync(path.join(paths.downloadsDir, 'chrome.zip'), 'utf8'), 'zip');
    assert.equal(fs.existsSync(legacyBaseDir), false);
  });

  it('migrates legacy Windows runtime data into ~/.js-eyes', () => {
    delete process.env.JS_EYES_HOME;
    const env = { APPDATA: path.join(tempHome, 'AppData', 'Roaming') };
    const legacyBaseDir = resolveLegacyBaseDir('win32', tempHome, env);
    fs.mkdirSync(path.join(legacyBaseDir, 'cache'), { recursive: true });
    fs.writeFileSync(path.join(legacyBaseDir, 'cache', 'state.json'), '{"ok":true}\n');

    const paths = ensureRuntimePaths({ home: tempHome, platform: 'win32', env });
    assert.equal(fs.readFileSync(path.join(paths.cacheDir, 'state.json'), 'utf8'), '{"ok":true}\n');
    assert.equal(fs.existsSync(legacyBaseDir), false);
  });

  it('loads defaults and persists config updates', () => {
    const initial = loadConfig();
    assert.equal(initial.serverHost, 'localhost');
    assert.equal(initial.serverPort, 18080);
    assert.deepEqual(initial.skillsEnabled, {});

    setConfigValue('serverPort', 19090);
    setConfigValue('skillsEnabled.js-x-ops-skill', true);
    const next = loadConfig();
    assert.equal(next.serverPort, 19090);
    assert.equal(next.skillsEnabled['js-x-ops-skill'], true);
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
  const skillIds = [
    'js-bilibili-ops-skill',
    'js-jike-ops-skill',
    'js-reddit-ops-skill',
    'js-wechat-ops-skill',
    'js-x-ops-skill',
    'js-xiaohongshu-ops-skill',
    'js-youtube-ops-skill',
    'js-zhihu-ops-skill',
  ];

  it('keeps runtime entrypoints under packages instead of root compatibility trees', () => {
    assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'openclaw-plugin', 'index.mjs')), true);
    assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'server-core', 'index.js')), true);
    assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'client-sdk', 'index.js')), true);

    assert.equal(fs.existsSync(path.join(repoRoot, 'openclaw-plugin', 'index.mjs')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'server', 'index.js')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'clients', 'js-eyes-client.js')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'cli', 'cli.js')), false);
  });

  it('ships skill contracts and adapters for all platform skills', () => {
    for (const skillId of skillIds) {
      const skillDir = path.join(repoRoot, 'skills', skillId);
      assert.equal(fs.existsSync(path.join(skillDir, 'skill.contract.js')), true, `${skillId} missing skill.contract.js`);
      assert.equal(fs.existsSync(path.join(skillDir, 'cli', 'index.js')), true, `${skillId} missing cli/index.js`);

      const pluginPkg = require(path.join(skillDir, 'openclaw-plugin', 'package.json'));
      assert.equal(pluginPkg.engines.node, '>=22.0.0');
      assert.equal(pluginPkg.peerDependencies.openclaw, '>=0.0.0');
    }
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

  it('reconstructs argv from parsed flags', () => {
    assert.deepEqual(flagsToArgv({ force: true, port: '19090' }), ['--force', '--port', '19090']);
  });
});

describe('skill runtime helpers', () => {
  let tempRoot;
  let skillRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-skill-'));
    skillRoot = path.join(tempRoot, 'mock-skill');
    fs.mkdirSync(path.join(skillRoot, 'cli'), { recursive: true });
    fs.mkdirSync(path.join(skillRoot, 'openclaw-plugin'), { recursive: true });

    fs.writeFileSync(path.join(skillRoot, 'package.json'), JSON.stringify({
      name: 'mock-skill',
      version: '1.0.0',
      description: 'mock skill',
    }, null, 2));
    fs.writeFileSync(path.join(skillRoot, 'openclaw-plugin', 'openclaw.plugin.json'), JSON.stringify({
      id: 'mock-skill',
      name: 'Mock Skill',
      description: 'mock skill',
      configSchema: {
        type: 'object',
        additionalProperties: false,
      },
    }, null, 2));
    fs.writeFileSync(path.join(skillRoot, 'skill.contract.js'), `
module.exports = {
  id: 'mock-skill',
  name: 'Mock Skill',
  description: 'mock skill',
  version: '1.0.0',
  cli: {
    entry: './cli/index.js',
    commands: [{ name: 'echo', description: 'echo argv' }]
  },
  openclaw: {
    tools: [{ name: 'mock_tool', description: 'mock tool', parameters: { type: 'object', properties: {} } }]
  }
};
`);
    fs.writeFileSync(path.join(skillRoot, 'cli', 'index.js'), '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('loads contract metadata from an installed skill directory', () => {
    const meta = normalizeSkillMetadata(skillRoot);
    assert.equal(meta.id, 'mock-skill');
    assert.deepEqual(meta.commands, ['echo']);
    assert.deepEqual(meta.tools, ['mock_tool']);
  });

  it('discovers local skills and runs their CLI adapter', () => {
    const discovered = discoverLocalSkills(tempRoot);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].id, 'mock-skill');

    const result = runSkillCli({
      skillDir: skillRoot,
      argv: ['echo', 'hello'],
      stdio: 'pipe',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '["echo","hello"]');
  });
});

describe('video skill yt-dlp resolution', () => {
  const originalPath = process.env.PATH;
  const originalYtDlpPath = process.env.YTDLP_PATH;
  let tempBinDir;

  beforeEach(() => {
    tempBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-ytdlp-'));
    const filename = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    fs.writeFileSync(path.join(tempBinDir, filename), '');
    process.env.PATH = [tempBinDir, originalPath || ''].filter(Boolean).join(path.delimiter);
    delete process.env.YTDLP_PATH;
  });

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }

    if (originalYtDlpPath === undefined) {
      delete process.env.YTDLP_PATH;
    } else {
      process.env.YTDLP_PATH = originalYtDlpPath;
    }

    fs.rmSync(tempBinDir, { recursive: true, force: true });
  });

  it('prefers yt-dlp binaries discoverable from PATH', () => {
    const expectedPath = path.join(tempBinDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

    assert.equal(getYoutubeYtDlpCommand().command, expectedPath);
    assert.equal(getBilibiliYtDlpCommand().command, expectedPath);
  });
});
