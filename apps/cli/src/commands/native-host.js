'use strict';

const {
  NATIVE_HOST_NAME,
  installNativeHostBrowsers,
  print,
  resolveNativeHostScript,
  statusNativeHostBrowsers,
  uninstallNativeHostBrowsers,
} = require('../command-context');

async function commandNativeHost(positionals, flags) {
  const action = positionals[1] || 'status';
  const selector = flags.browser || 'all';

  switch (action) {
    case 'install': {
      const results = installNativeHostBrowsers(selector);
      print(`Native messaging host: ${NATIVE_HOST_NAME}`);
      print(`Launcher points to: ${resolveNativeHostScript()}`);
      for (const item of results) {
        if (item.status === 'installed') {
          print(`- ${item.browser}: installed`);
          print(`    manifest: ${item.manifestPath}`);
          print(`    launcher: ${item.launcherPath}`);
          if (item.registryKey) {
            print(`    registry: ${item.registryKey}`);
          }
        } else {
          print(`- ${item.browser}: FAILED (${item.error})`);
          process.exitCode = 1;
        }
      }
      return;
    }
    case 'uninstall': {
      const results = uninstallNativeHostBrowsers(selector);
      for (const item of results) {
        if (item.status === 'uninstalled') {
          print(`- ${item.browser}: removed`);
          print(`    manifest: ${item.manifestPath}`);
          if (item.registryKey) {
            print(`    registry: ${item.registryKey}`);
          }
        } else {
          print(`- ${item.browser}: FAILED (${item.error})`);
          process.exitCode = 1;
        }
      }
      return;
    }
    case 'status': {
      const results = statusNativeHostBrowsers(selector);
      print(`Native messaging host: ${NATIVE_HOST_NAME}`);
      print(`Host script: ${resolveNativeHostScript()}`);
      for (const item of results) {
        const flag = item.installed ? 'installed' : 'missing';
        print(`- ${item.browser}: ${flag}`);
        print(`    manifest: ${item.manifestPath}`);
        if (item.manifest) {
          const allowed = item.manifest.allowed_extensions
            || (item.manifest.allowed_origins || []).map((o) => o.replace(/^chrome-extension:\/\//, '').replace(/\/$/, ''));
          print(`    allowed: ${(allowed || []).join(', ') || '(none)'}`);
        }
        print(`    launcher: ${item.launcherPath}${item.launcherExists ? '' : ' (missing)'}`);
      }
      return;
    }
    default:
      throw new Error('\u7528\u6cd5: `js-eyes native-host install|uninstall|status [--browser all|chrome|firefox|chromium|edge|brave|chromium|chrome-canary]`');
  }
}

module.exports = { commandNativeHost };
