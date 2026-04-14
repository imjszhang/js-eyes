'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig, mergeRecordingConfig, parseConfigValue, saveConfig, setConfigValue } = require('@js-eyes/config');
const { COMPATIBILITY_MATRIX, PROTOCOL_VERSION } = require('@js-eyes/protocol');
const { discoverLocalSkills, normalizeSkillMetadata, runSkillCli } = require('@js-eyes/protocol/skills');
const protocolPkg = require('@js-eyes/protocol/package.json');
const { getYtDlpCommand: getBilibiliYtDlpCommand } = require('../skills/js-bilibili-ops-skill/lib/bilibiliUtils');
const { getYtDlpCommand: getYoutubeYtDlpCommand } = require('../skills/js-youtube-ops-skill/lib/youtubeUtils');
const { ensureRuntimePaths, ensureSkillRecordPaths, getPaths, getSkillRecordPaths, resolveLegacyBaseDir } = require('@js-eyes/runtime-paths');
const { createSkillRunContext } = require('@js-eyes/skill-recording');
const { createRunContext } = require('../skills/js-reddit-ops-skill/lib/runContext');
const { appendHistory } = require('../skills/js-reddit-ops-skill/lib/history');
const { readCacheEntry, writeCacheEntry } = require('../skills/js-reddit-ops-skill/lib/cache');
const { writeDebugBundle } = require('../skills/js-reddit-ops-skill/lib/debug');
const { parseArgs, resolveExtensionAsset, getServerOptions, flagsToArgv, resolvePluginPath } = require('../apps/cli/src/cli');

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
    assert.equal(paths.skillRecordsDir, path.join(tempHome, 'skill-records'));
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
    assert.equal(initial.recording.mode, 'standard');
    assert.equal(initial.recording.cacheTtlMinutes, 60);

    setConfigValue('serverPort', 19090);
    setConfigValue('skillsEnabled.js-x-ops-skill', true);
    setConfigValue('recording.mode', 'debug');
    const next = loadConfig();
    assert.equal(next.serverPort, 19090);
    assert.equal(next.skillsEnabled['js-x-ops-skill'], true);
    assert.equal(next.recording.mode, 'debug');
  });

  it('preserves recording defaults when only one nested field is saved', () => {
    saveConfig({ recording: { mode: 'history' } });
    const config = loadConfig();
    assert.equal(config.recording.mode, 'history');
    assert.equal(config.recording.cacheTtlMinutes, 60);
    assert.equal(config.recording.saveRawHtml, false);
  });

  it('derives per-skill record directories outside installed skill roots', () => {
    const paths = getSkillRecordPaths('js-reddit-ops-skill');
    assert.equal(paths.skillDir, path.join(tempHome, 'skill-records', 'js-reddit-ops-skill'));
    assert.equal(paths.historyDir, path.join(tempHome, 'skill-records', 'js-reddit-ops-skill', 'history'));

    const ensured = ensureSkillRecordPaths('js-reddit-ops-skill');
    assert.equal(fs.existsSync(ensured.cacheDir), true);
    assert.equal(fs.existsSync(ensured.debugDir), true);
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

  it('merges recording defaults with overrides', () => {
    const merged = mergeRecordingConfig({ mode: 'debug' }, { baseDir: '/tmp/js-eyes-records' });
    assert.equal(merged.mode, 'debug');
    assert.equal(merged.baseDir, '/tmp/js-eyes-records');
    assert.equal(merged.cacheTtlMinutes, 60);
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

  it('keeps the OpenClaw plugin as a root-level optional component', () => {
    assert.equal(fs.existsSync(path.join(repoRoot, 'openclaw-plugin', 'index.mjs')), true);
    assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'server-core', 'index.js')), true);
    assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'client-sdk', 'index.js')), true);

    assert.equal(fs.existsSync(path.join(repoRoot, 'packages', 'openclaw-plugin', 'index.mjs')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'server', 'index.js')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'clients', 'js-eyes-client.js')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'cli', 'cli.js')), false);
  });

  it('ships skill contracts and adapters for all platform skills', () => {
    for (const skillId of skillIds) {
      const skillDir = path.join(repoRoot, 'skills', skillId);
      assert.equal(fs.existsSync(path.join(skillDir, 'skill.contract.js')), true, `${skillId} missing skill.contract.js`);
      assert.equal(fs.existsSync(path.join(skillDir, 'cli', 'index.js')), true, `${skillId} missing cli/index.js`);
      assert.equal(fs.existsSync(path.join(skillDir, 'openclaw-plugin', 'index.mjs')), false, `${skillId} should not ship child plugin entry`);
      assert.equal(fs.existsSync(path.join(skillDir, 'openclaw-plugin', 'package.json')), false, `${skillId} should not ship child plugin package`);
      assert.equal(fs.existsSync(path.join(skillDir, 'openclaw-plugin', 'openclaw.plugin.json')), false, `${skillId} should not ship child plugin manifest`);
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

  it('resolves the repo-root OpenClaw plugin component path', () => {
    assert.equal(resolvePluginPath(), path.join(path.resolve(__dirname, '..'), 'openclaw-plugin'));
  });
});

describe('skill runtime helpers', () => {
  let tempRoot;
  let skillRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-skill-'));
    skillRoot = path.join(tempRoot, 'mock-skill');
    fs.mkdirSync(path.join(skillRoot, 'cli'), { recursive: true });

    fs.writeFileSync(path.join(skillRoot, 'package.json'), JSON.stringify({
      name: 'mock-skill',
      version: '1.0.0',
      description: 'mock skill',
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

describe('skill recording helpers', () => {
  const originalHome = process.env.JS_EYES_HOME;
  let tempHome;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-recording-'));
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

  it('creates run contexts with cache and debug policy', () => {
    const context = createRunContext({
      skillId: 'js-reddit-ops-skill',
      scrapeType: 'reddit_post',
      skillVersion: '1.0.0',
      url: 'https://www.reddit.com/r/test/comments/abc123/example/?utm_source=test',
      recording: {
        mode: 'debug',
        baseDir: '',
        cacheTtlMinutes: 5,
        saveRawHtml: true,
        maxDebugBundles: 2,
      },
    });

    assert.equal(context.normalizedUrl, 'https://www.reddit.com/r/test/comments/abc123/example');
    assert.equal(context.recording.cacheEnabled, true);
    assert.equal(context.recording.debugEnabled, true);
    assert.equal(context.paths.skillDir, path.join(tempHome, 'skill-records', 'js-reddit-ops-skill'));
  });

  it('creates generic run contexts with injected normalization and cache key parts', () => {
    const context = createSkillRunContext({
      skillId: 'js-zhihu-ops-skill',
      scrapeType: 'zhihu_answer',
      skillVersion: '1.0.0',
      url: 'https://www.zhihu.com/question/1/answer/2/?utm_source=test',
      recording: {
        mode: 'history',
        baseDir: '',
        cacheTtlMinutes: 30,
        saveRawHtml: false,
        maxDebugBundles: 5,
      },
      normalizeInput: (input) => input.replace(/\/\?utm_source=test$/, ''),
      buildCacheKeyParts: ({ skillId, scrapeType, normalizedInput }) => ({
        skillId,
        scrapeType,
        url: normalizedInput,
      }),
    });

    assert.equal(context.normalizedUrl, 'https://www.zhihu.com/question/1/answer/2');
    assert.equal(context.recording.historyEnabled, true);
    assert.equal(context.recording.cacheEnabled, false);
  });

  it('writes history, cache, and debug bundles into skill-specific directories', () => {
    const context = createRunContext({
      skillId: 'js-reddit-ops-skill',
      scrapeType: 'reddit_post',
      skillVersion: '1.0.0',
      url: 'https://www.reddit.com/r/test/comments/abc123/example/',
      runId: 'run-test',
      recording: {
        mode: 'debug',
        baseDir: '',
        cacheTtlMinutes: 5,
        saveRawHtml: true,
        maxDebugBundles: 3,
      },
    });

    const historyPath = appendHistory(context, { run_id: context.runId, status: 'success' });
    assert.equal(fs.existsSync(historyPath), true);

    const cacheEntry = writeCacheEntry(context, {
      response: {
        platform: 'reddit',
        scrapeType: 'reddit_post',
        timestamp: new Date().toISOString(),
        sourceUrl: context.sourceUrl,
        result: { title: 'Example', comments: [] },
        metrics: { status: 'success' },
      },
    });
    assert.equal(fs.existsSync(cacheEntry.filePath), true);
    assert.equal(readCacheEntry(context).cacheKey, context.cacheKey);

    const bundleDir = writeDebugBundle(context, {
      meta: { runId: context.runId },
      steps: [{ step: 'started' }],
      domStats: [{ label: 'before_prepare', commentCount: 0 }],
      result: { ok: true },
      rawHtml: '<html></html>',
    });
    assert.equal(fs.existsSync(path.join(bundleDir, 'meta.json')), true);
    assert.equal(fs.existsSync(path.join(bundleDir, 'raw.html')), true);
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
