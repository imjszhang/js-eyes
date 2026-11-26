'use strict';

const os = require('os');
const path = require('path');

const { NATIVE_HOST_NAME } = require('./manifest');

function manifestFileName() {
  return `${NATIVE_HOST_NAME}.json`;
}

function getBrowserManifestDirs(platform, env = process.env, home = os.homedir()) {
  switch (platform) {
    case 'darwin':
      return {
        chrome: path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
        'chrome-canary': path.join(home, 'Library', 'Application Support', 'Google', 'Chrome Canary', 'NativeMessagingHosts'),
        chromium: path.join(home, 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
        edge: path.join(home, 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'),
        brave: path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
        firefox: path.join(home, 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts'),
      };
    case 'win32': {
      const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
      const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      return {
        chrome: path.join(localAppData, 'js-eyes', 'native-host'),
        'chrome-canary': path.join(localAppData, 'js-eyes', 'native-host'),
        chromium: path.join(localAppData, 'js-eyes', 'native-host'),
        edge: path.join(localAppData, 'js-eyes', 'native-host'),
        brave: path.join(localAppData, 'js-eyes', 'native-host'),
        firefox: path.join(appData, 'js-eyes', 'native-host'),
      };
    }
    default:
      return {
        chrome: path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts'),
        'chrome-canary': path.join(home, '.config', 'google-chrome-canary', 'NativeMessagingHosts'),
        chromium: path.join(home, '.config', 'chromium', 'NativeMessagingHosts'),
        edge: path.join(home, '.config', 'microsoft-edge', 'NativeMessagingHosts'),
        brave: path.join(home, '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
        firefox: path.join(home, '.mozilla', 'native-messaging-hosts'),
      };
  }
}

function getLauncherDir(platform, env = process.env, home = os.homedir()) {
  switch (platform) {
    case 'darwin':
      return path.join(home, '.js-eyes', 'native-host');
    case 'win32':
      return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'js-eyes', 'native-host');
    default:
      return path.join(home, '.js-eyes', 'native-host');
  }
}

function getWindowsRegistryPaths() {
  return {
    chrome: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${require('./manifest').NATIVE_HOST_NAME}`,
    'chrome-canary': `HKCU\\Software\\Google\\Chrome SxS\\NativeMessagingHosts\\${require('./manifest').NATIVE_HOST_NAME}`,
    chromium: `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${require('./manifest').NATIVE_HOST_NAME}`,
    edge: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${require('./manifest').NATIVE_HOST_NAME}`,
    brave: `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${require('./manifest').NATIVE_HOST_NAME}`,
    firefox: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${require('./manifest').NATIVE_HOST_NAME}`,
  };
}

const BROWSER_FAMILY = Object.freeze({
  chrome: 'chromium-family',
  'chrome-canary': 'chromium-family',
  chromium: 'chromium-family',
  edge: 'chromium-family',
  brave: 'chromium-family',
  firefox: 'firefox-family',
});

const CHROMIUM_BROWSERS = Object.freeze(['chrome', 'chrome-canary', 'chromium', 'edge', 'brave']);
const FIREFOX_BROWSERS = Object.freeze(['firefox']);
const ALL_BROWSERS = Object.freeze([...CHROMIUM_BROWSERS, ...FIREFOX_BROWSERS]);

function resolveBrowsers(selector) {
  if (!selector || selector === 'all') {
    return ALL_BROWSERS.slice();
  }
  if (Array.isArray(selector)) {
    return selector.filter((item) => ALL_BROWSERS.includes(item));
  }
  if (selector === 'chromium') return CHROMIUM_BROWSERS.slice();
  if (selector === 'firefox') return FIREFOX_BROWSERS.slice();
  if (selector === 'chrome') return ['chrome'];
  if (ALL_BROWSERS.includes(selector)) return [selector];
  throw new Error(`unknown browser selector: ${selector}`);
}

module.exports = {
  ALL_BROWSERS,
  BROWSER_FAMILY,
  CHROMIUM_BROWSERS,
  FIREFOX_BROWSERS,
  getBrowserManifestDirs,
  getLauncherDir,
  getWindowsRegistryPaths,
  manifestFileName,
  resolveBrowsers,
};
