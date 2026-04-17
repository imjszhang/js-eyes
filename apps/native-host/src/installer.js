'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { buildManifest, NATIVE_HOST_NAME } = require('./manifest');
const {
  CHROMIUM_BROWSERS,
  FIREFOX_BROWSERS,
  getBrowserManifestDirs,
  getLauncherDir,
  getWindowsRegistryPaths,
  manifestFileName,
  resolveBrowsers,
} = require('./paths');

const LAUNCHER_POSIX = 'js-eyes-native-host';
const LAUNCHER_WIN = 'js-eyes-native-host.bat';

function resolveHostScriptPath() {
  const candidate = path.resolve(__dirname, '..', 'bin', 'js-eyes-native-host.js');
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  const fallback = require.resolve('@js-eyes/native-host/bin/js-eyes-native-host.js');
  return fallback;
}

function detectBrowserFamily(browser) {
  if (CHROMIUM_BROWSERS.includes(browser)) return 'chromium';
  if (FIREFOX_BROWSERS.includes(browser)) return 'firefox';
  throw new Error(`unknown browser: ${browser}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeLauncher({ platform, launcherDir, hostScriptPath, nodeExec }) {
  ensureDir(launcherDir);
  if (platform === 'win32') {
    const launcherPath = path.join(launcherDir, LAUNCHER_WIN);
    const nodePath = nodeExec || process.execPath;
    const content = [
      '@echo off',
      `"${nodePath}" "${hostScriptPath}" %*`,
      '',
    ].join('\r\n');
    fs.writeFileSync(launcherPath, content, 'utf8');
    return launcherPath;
  }
  const launcherPath = path.join(launcherDir, LAUNCHER_POSIX);
  const nodePath = nodeExec || process.execPath;
  const content = [
    '#!/bin/sh',
    `exec "${nodePath}" "${hostScriptPath}" "$@"`,
    '',
  ].join('\n');
  fs.writeFileSync(launcherPath, content, 'utf8');
  try {
    fs.chmodSync(launcherPath, 0o755);
  } catch {}
  return launcherPath;
}

function removeLauncher({ platform, launcherDir }) {
  const launcherPath = platform === 'win32'
    ? path.join(launcherDir, LAUNCHER_WIN)
    : path.join(launcherDir, LAUNCHER_POSIX);
  if (fs.existsSync(launcherPath)) {
    try { fs.rmSync(launcherPath, { force: true }); } catch {}
  }
  return launcherPath;
}

function writeManifestFile({ manifest, targetDir }) {
  ensureDir(targetDir);
  const filePath = path.join(targetDir, manifestFileName());
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  try {
    fs.chmodSync(filePath, 0o644);
  } catch {}
  return filePath;
}

function removeManifestFile({ targetDir }) {
  const filePath = path.join(targetDir, manifestFileName());
  if (fs.existsSync(filePath)) {
    try { fs.rmSync(filePath, { force: true }); } catch {}
  }
  return filePath;
}

function writeWindowsRegistry({ browser, manifestPath, runCommand = defaultRegRun }) {
  const registryKey = getWindowsRegistryPaths()[browser];
  if (!registryKey) {
    throw new Error(`no registry path for browser: ${browser}`);
  }
  runCommand(['reg', 'add', registryKey, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f']);
  return registryKey;
}

function removeWindowsRegistry({ browser, runCommand = defaultRegRun, ignoreErrors = true }) {
  const registryKey = getWindowsRegistryPaths()[browser];
  if (!registryKey) {
    throw new Error(`no registry path for browser: ${browser}`);
  }
  try {
    runCommand(['reg', 'delete', registryKey, '/f']);
  } catch (error) {
    if (!ignoreErrors) throw error;
  }
  return registryKey;
}

function defaultRegRun(argv) {
  const [cmd, ...args] = argv;
  execFileSync(cmd, args, { stdio: 'ignore' });
}

function installForBrowser({
  browser,
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  launcherDir,
  hostScriptPath,
  nodeExec,
  runRegistry,
}) {
  const family = detectBrowserFamily(browser);
  const manifestDirs = getBrowserManifestDirs(platform, env, home);
  const targetDir = manifestDirs[browser];
  if (!targetDir) {
    throw new Error(`no manifest dir for browser=${browser} on platform=${platform}`);
  }

  const resolvedLauncherDir = launcherDir || getLauncherDir(platform, env, home);
  const resolvedHostScript = hostScriptPath || resolveHostScriptPath();
  const launcherPath = writeLauncher({
    platform,
    launcherDir: resolvedLauncherDir,
    hostScriptPath: resolvedHostScript,
    nodeExec,
  });

  const manifest = buildManifest(
    family === 'chromium' ? 'chrome' : 'firefox',
    { launcherPath }
  );

  const manifestPath = writeManifestFile({ manifest, targetDir });

  let registryKey = null;
  if (platform === 'win32') {
    registryKey = writeWindowsRegistry({
      browser,
      manifestPath,
      runCommand: runRegistry,
    });
  }

  return {
    browser,
    family,
    platform,
    hostScriptPath: resolvedHostScript,
    launcherDir: resolvedLauncherDir,
    launcherPath,
    manifestDir: targetDir,
    manifestPath,
    registryKey,
    status: 'installed',
  };
}

function uninstallForBrowser({
  browser,
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  launcherDir,
  runRegistry,
}) {
  const manifestDirs = getBrowserManifestDirs(platform, env, home);
  const targetDir = manifestDirs[browser];
  if (!targetDir) {
    throw new Error(`no manifest dir for browser=${browser} on platform=${platform}`);
  }
  const manifestPath = removeManifestFile({ targetDir });

  let registryKey = null;
  if (platform === 'win32') {
    registryKey = removeWindowsRegistry({
      browser,
      runCommand: runRegistry,
    });
  }

  const resolvedLauncherDir = launcherDir || getLauncherDir(platform, env, home);
  const launcherPath = removeLauncher({ platform, launcherDir: resolvedLauncherDir });

  return {
    browser,
    platform,
    manifestDir: targetDir,
    manifestPath,
    launcherDir: resolvedLauncherDir,
    launcherPath,
    registryKey,
    status: 'uninstalled',
  };
}

function statusForBrowser({
  browser,
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
}) {
  const manifestDirs = getBrowserManifestDirs(platform, env, home);
  const targetDir = manifestDirs[browser];
  if (!targetDir) {
    return { browser, installed: false, reason: 'no-manifest-dir' };
  }
  const manifestPath = path.join(targetDir, manifestFileName());
  const installed = fs.existsSync(manifestPath);
  let manifest = null;
  if (installed) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      manifest = null;
    }
  }
  const launcherDir = getLauncherDir(platform, env, home);
  const launcherPath = platform === 'win32'
    ? path.join(launcherDir, LAUNCHER_WIN)
    : path.join(launcherDir, LAUNCHER_POSIX);
  return {
    browser,
    installed,
    manifestPath,
    manifest,
    launcherPath,
    launcherExists: fs.existsSync(launcherPath),
  };
}

function installBrowsers(selector, options = {}) {
  const browsers = resolveBrowsers(selector);
  const results = [];
  for (const browser of browsers) {
    try {
      results.push(installForBrowser({ browser, ...options }));
    } catch (error) {
      results.push({ browser, status: 'error', error: error.message });
    }
  }
  return results;
}

function uninstallBrowsers(selector, options = {}) {
  const browsers = resolveBrowsers(selector);
  const results = [];
  for (const browser of browsers) {
    try {
      results.push(uninstallForBrowser({ browser, ...options }));
    } catch (error) {
      results.push({ browser, status: 'error', error: error.message });
    }
  }
  return results;
}

function statusBrowsers(selector, options = {}) {
  const browsers = resolveBrowsers(selector);
  return browsers.map((browser) => statusForBrowser({ browser, ...options }));
}

module.exports = {
  LAUNCHER_POSIX,
  LAUNCHER_WIN,
  NATIVE_HOST_NAME,
  installBrowsers,
  installForBrowser,
  resolveHostScriptPath,
  statusBrowsers,
  statusForBrowser,
  uninstallBrowsers,
  uninstallForBrowser,
  writeLauncher,
  writeManifestFile,
  writeWindowsRegistry,
  removeWindowsRegistry,
};
