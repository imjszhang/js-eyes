'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { CHROME_EXTENSION_ID, FIREFOX_EXTENSION_ID } = require('../apps/native-host/src/extension-ids');

async function loadSetup() {
  return import('../openclaw-plugin/native-host-setup.mjs');
}

function firefoxStatus(overrides = {}) {
  const launcherPath = overrides.launcherPath || '/tmp/js-eyes-native-host';
  return {
    browser: 'firefox',
    installed: true,
    launcherPath,
    launcherExists: true,
    manifest: {
      path: launcherPath,
      allowed_extensions: [FIREFOX_EXTENSION_ID],
    },
    ...overrides,
  };
}

function chromeStatus(overrides = {}) {
  const launcherPath = overrides.launcherPath || '/tmp/js-eyes-native-host';
  return {
    browser: 'chrome',
    installed: true,
    launcherPath,
    launcherExists: true,
    manifest: {
      path: launcherPath,
      allowed_origins: [`chrome-extension://${CHROME_EXTENSION_ID}/`],
    },
    ...overrides,
  };
}

describe('openclaw native-host setup', () => {
  it('classifies missing manifests', async () => {
    const { classifyNativeHostStatus } = await loadSetup();
    const classification = classifyNativeHostStatus({ browser: 'firefox', installed: false });
    assert.equal(classification.ok, false);
    assert.equal(classification.code, 'missing-manifest');
  });

  it('classifies stale launcher and allowed extension mismatches', async () => {
    const { classifyNativeHostStatus } = await loadSetup();

    const stale = classifyNativeHostStatus(firefoxStatus({
      manifest: {
        path: '/old/js-eyes-native-host',
        allowed_extensions: [FIREFOX_EXTENSION_ID],
      },
    }));
    assert.equal(stale.code, 'stale-launcher-path');

    const mismatch = classifyNativeHostStatus(chromeStatus({
      manifest: {
        path: '/tmp/js-eyes-native-host',
        allowed_origins: ['chrome-extension://not-js-eyes/'],
      },
    }));
    assert.equal(mismatch.code, 'allowed-extension-mismatch');
  });

  it('repairs missing browser registrations with the installer', async () => {
    const { ensureNativeHost } = await loadSetup();
    const installed = [];
    const installer = {
      statusBrowsers(selector) {
        assert.equal(selector, 'firefox');
        return [{ browser: 'firefox', installed: false }];
      },
      installBrowsers(browser) {
        installed.push(browser);
        return [{ browser, status: 'installed' }];
      },
    };

    const result = ensureNativeHost({ browser: 'firefox' }, { installer });
    assert.deepEqual(installed, ['firefox']);
    assert.equal(result.repairs.length, 1);
    assert.equal(result.repairs[0].browser, 'firefox');
  });

  it('does not repair healthy registrations', async () => {
    const { ensureNativeHost } = await loadSetup();
    const installer = {
      statusBrowsers() {
        return [firefoxStatus()];
      },
      installBrowsers() {
        assert.fail('healthy native-host registration should not be repaired');
      },
    };

    const result = ensureNativeHost({ browser: 'firefox' }, { installer });
    assert.equal(result.statuses[0].classification.ok, true);
    assert.equal(result.repairs.length, 0);
  });

  it('honors warnOnly and autoInstall=false', async () => {
    const { ensureNativeHost, summarizeNativeHostResult } = await loadSetup();
    const installer = {
      statusBrowsers() {
        return [{ browser: 'firefox', installed: false }];
      },
      installBrowsers() {
        assert.fail('warnOnly should not call installer');
      },
    };

    const warnOnly = ensureNativeHost({ browser: 'firefox', warnOnly: true }, { installer });
    assert.equal(warnOnly.statuses[0].classification.code, 'missing-manifest');
    assert.equal(warnOnly.repairs.length, 0);
    assert.match(summarizeNativeHostResult(warnOnly), /needs attention: firefox \(missing-manifest\)/);

    const disabled = ensureNativeHost({ autoInstall: false }, { installer });
    assert.equal(disabled.skipped, true);
    assert.equal(disabled.statuses.length, 0);
  });
});

