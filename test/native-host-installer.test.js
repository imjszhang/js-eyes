'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getBrowserManifestDirs,
  getLauncherDir,
  getWindowsRegistryPaths,
  resolveBrowsers,
  ALL_BROWSERS,
  CHROMIUM_BROWSERS,
  FIREFOX_BROWSERS,
} = require('../apps/native-host/src/paths');

const {
  buildChromeManifest,
  buildFirefoxManifest,
  NATIVE_HOST_NAME,
  CHROME_ALLOWED_EXTENSION_IDS,
  FIREFOX_ALLOWED_EXTENSION_IDS,
} = require('../apps/native-host/src/manifest');

const {
  installForBrowser,
  uninstallForBrowser,
  statusForBrowser,
} = require('../apps/native-host/src/installer');

describe('native-host paths', () => {
  it('returns macOS NativeMessagingHosts paths under ~/Library/Application Support', () => {
    const dirs = getBrowserManifestDirs('darwin', {}, '/Users/foo');
    assert.match(dirs.chrome, /Library\/Application Support\/Google\/Chrome\/NativeMessagingHosts$/);
    assert.match(dirs.firefox, /Library\/Application Support\/Mozilla\/NativeMessagingHosts$/);
  });

  it('returns Linux XDG config paths', () => {
    const dirs = getBrowserManifestDirs('linux', {}, '/home/foo');
    assert.equal(dirs.chrome, '/home/foo/.config/google-chrome/NativeMessagingHosts');
    assert.equal(dirs.chromium, '/home/foo/.config/chromium/NativeMessagingHosts');
    assert.equal(dirs.firefox, '/home/foo/.mozilla/native-messaging-hosts');
  });

  it('returns Windows LOCALAPPDATA / APPDATA paths', () => {
    const dirs = getBrowserManifestDirs('win32', {
      LOCALAPPDATA: 'C:/Users/foo/AppData/Local',
      APPDATA: 'C:/Users/foo/AppData/Roaming',
    }, 'C:/Users/foo');
    assert.ok(dirs.chrome.endsWith('js-eyes/native-host'));
    assert.ok(dirs.firefox.endsWith('js-eyes/native-host'));
    assert.ok(dirs.chrome.includes('Local'));
    assert.ok(dirs.firefox.includes('Roaming'));
  });

  it('Windows registry paths include all browser families', () => {
    const keys = getWindowsRegistryPaths();
    for (const browser of ALL_BROWSERS) {
      assert.ok(keys[browser], `expected registry key for ${browser}`);
      assert.ok(keys[browser].endsWith(NATIVE_HOST_NAME));
    }
  });

  it('getLauncherDir returns platform-specific dir', () => {
    assert.ok(getLauncherDir('darwin', {}, '/tmp').endsWith('.js-eyes/native-host'));
    assert.ok(getLauncherDir('linux', {}, '/tmp').endsWith('.js-eyes/native-host'));
    assert.ok(getLauncherDir('win32', { LOCALAPPDATA: 'C:/L' }, 'C:/H').endsWith('js-eyes/native-host') || getLauncherDir('win32', { LOCALAPPDATA: 'C:/L' }, 'C:/H').endsWith('js-eyes\\native-host'));
  });
});

describe('native-host manifest', () => {
  it('builds Chrome manifest with allowed_origins', () => {
    const m = buildChromeManifest({ launcherPath: '/tmp/launcher' });
    assert.equal(m.name, NATIVE_HOST_NAME);
    assert.equal(m.type, 'stdio');
    assert.equal(m.path, '/tmp/launcher');
    assert.ok(Array.isArray(m.allowed_origins));
    assert.ok(m.allowed_origins.length > 0);
    for (const origin of m.allowed_origins) {
      assert.ok(origin.startsWith('chrome-extension://'));
      assert.ok(origin.endsWith('/'));
    }
  });

  it('builds Firefox manifest with allowed_extensions', () => {
    const m = buildFirefoxManifest({ launcherPath: '/tmp/launcher' });
    assert.equal(m.name, NATIVE_HOST_NAME);
    assert.equal(m.type, 'stdio');
    assert.deepEqual(m.allowed_extensions, FIREFOX_ALLOWED_EXTENSION_IDS.slice());
  });
});

describe('native-host selector', () => {
  it('resolves "all" to every browser', () => {
    assert.deepEqual(resolveBrowsers('all').sort(), ALL_BROWSERS.slice().sort());
  });
  it('resolves "chromium" to the Chromium family', () => {
    assert.deepEqual(resolveBrowsers('chromium').sort(), CHROMIUM_BROWSERS.slice().sort());
  });
  it('resolves "firefox" to firefox only', () => {
    assert.deepEqual(resolveBrowsers('firefox'), FIREFOX_BROWSERS.slice());
  });
  it('rejects unknown selectors', () => {
    assert.throws(() => resolveBrowsers('safari'), /unknown browser/);
  });
});

describe('installForBrowser (POSIX sandbox)', () => {
  function withTmpHome() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jseyes-nh-install-'));
    return {
      home,
      cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
    };
  }

  it('installs Chrome manifest + launcher on linux', () => {
    const { home, cleanup } = withTmpHome();
    try {
      const result = installForBrowser({
        browser: 'chrome',
        platform: 'linux',
        env: {},
        home,
      });
      assert.equal(result.status, 'installed');
      assert.ok(fs.existsSync(result.manifestPath));
      assert.ok(fs.existsSync(result.launcherPath));
      const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
      assert.equal(manifest.name, NATIVE_HOST_NAME);
      assert.equal(manifest.type, 'stdio');
      assert.equal(manifest.path, result.launcherPath);
      assert.ok(Array.isArray(manifest.allowed_origins));
      const launcher = fs.readFileSync(result.launcherPath, 'utf8');
      assert.match(launcher, /^#!\/bin\/sh/);
    } finally {
      cleanup();
    }
  });

  it('installs Firefox manifest on darwin', () => {
    const { home, cleanup } = withTmpHome();
    try {
      const result = installForBrowser({
        browser: 'firefox',
        platform: 'darwin',
        env: {},
        home,
      });
      assert.equal(result.status, 'installed');
      const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
      assert.equal(manifest.name, NATIVE_HOST_NAME);
      assert.ok(Array.isArray(manifest.allowed_extensions));
      assert.ok(manifest.allowed_extensions.length > 0);
    } finally {
      cleanup();
    }
  });

  it('status reports installed/missing correctly', () => {
    const { home, cleanup } = withTmpHome();
    try {
      let status = statusForBrowser({ browser: 'chrome', platform: 'linux', env: {}, home });
      assert.equal(status.installed, false);

      installForBrowser({ browser: 'chrome', platform: 'linux', env: {}, home });
      status = statusForBrowser({ browser: 'chrome', platform: 'linux', env: {}, home });
      assert.equal(status.installed, true);
      assert.ok(status.manifest);

      uninstallForBrowser({ browser: 'chrome', platform: 'linux', env: {}, home });
      status = statusForBrowser({ browser: 'chrome', platform: 'linux', env: {}, home });
      assert.equal(status.installed, false);
    } finally {
      cleanup();
    }
  });

  it('writes Windows registry through injected runner', () => {
    const { home, cleanup } = withTmpHome();
    try {
      const regCalls = [];
      const result = installForBrowser({
        browser: 'chrome',
        platform: 'win32',
        env: { LOCALAPPDATA: path.join(home, 'Local'), APPDATA: path.join(home, 'Roaming') },
        home,
        runRegistry: (argv) => { regCalls.push(argv); },
      });
      assert.equal(result.status, 'installed');
      assert.equal(regCalls.length, 1);
      assert.equal(regCalls[0][0], 'reg');
      assert.equal(regCalls[0][1], 'add');
      assert.ok(regCalls[0].includes(result.manifestPath));
      assert.ok(fs.existsSync(result.launcherPath));
      assert.match(result.launcherPath, /\.bat$/);
      const bat = fs.readFileSync(result.launcherPath, 'utf8');
      assert.match(bat, /@echo off/);
    } finally {
      cleanup();
    }
  });
});

assert.ok(CHROME_ALLOWED_EXTENSION_IDS.length > 0);
