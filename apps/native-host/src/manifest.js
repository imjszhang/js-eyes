'use strict';

const { CHROME_EXTENSION_ID, FIREFOX_EXTENSION_ID } = require('./extension-ids');

const NATIVE_HOST_NAME = 'com.js_eyes.native_host';
const HOST_DESCRIPTION = 'JS Eyes native messaging host';

const FIREFOX_ALLOWED_EXTENSION_IDS = Object.freeze([FIREFOX_EXTENSION_ID]);

const CHROME_ALLOWED_EXTENSION_IDS = Object.freeze([CHROME_EXTENSION_ID]);

function buildChromeManifest({ launcherPath, allowedExtensionIds = CHROME_ALLOWED_EXTENSION_IDS } = {}) {
  if (!launcherPath) {
    throw new Error('launcherPath is required');
  }
  const ids = Array.from(allowedExtensionIds || []).filter(Boolean);
  return {
    name: NATIVE_HOST_NAME,
    description: HOST_DESCRIPTION,
    path: launcherPath,
    type: 'stdio',
    allowed_origins: ids.map((id) => `chrome-extension://${id}/`),
  };
}

function buildFirefoxManifest({ launcherPath, allowedExtensionIds = FIREFOX_ALLOWED_EXTENSION_IDS } = {}) {
  if (!launcherPath) {
    throw new Error('launcherPath is required');
  }
  return {
    name: NATIVE_HOST_NAME,
    description: HOST_DESCRIPTION,
    path: launcherPath,
    type: 'stdio',
    allowed_extensions: Array.from(allowedExtensionIds || []).filter(Boolean),
  };
}

function buildManifest(browser, options) {
  if (browser === 'chrome') return buildChromeManifest(options);
  if (browser === 'firefox') return buildFirefoxManifest(options);
  throw new Error(`unknown browser: ${browser}`);
}

module.exports = {
  NATIVE_HOST_NAME,
  HOST_DESCRIPTION,
  FIREFOX_ALLOWED_EXTENSION_IDS,
  CHROME_ALLOWED_EXTENSION_IDS,
  buildChromeManifest,
  buildFirefoxManifest,
  buildManifest,
};
