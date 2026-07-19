'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const config = require('../extensions/shared/config');
const sharedBrowserControl = require('../extensions/shared/browser-control-methods');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('extension shared runtime contract', () => {
  it('keeps generated platform copies byte-identical to the shared source', () => {
    assert.equal(read('extensions/chrome/config.js'), read('extensions/shared/config.js'));
    assert.equal(read('extensions/firefox/config.js'), read('extensions/shared/config.js'));
    assert.equal(read('extensions/chrome/background/utils.js'), read('extensions/shared/utils.js'));
    assert.equal(read('extensions/firefox/background/utils.js'), read('extensions/shared/utils.js'));
    assert.equal(read('extensions/chrome/background/browser-control-methods.js'), read('extensions/shared/browser-control-methods.js'));
    assert.equal(read('extensions/firefox/background/browser-control-methods.js'), read('extensions/shared/browser-control-methods.js'));
  });

  it('loads shared files before each platform background entrypoint', () => {
    const chromeManifest = JSON.parse(read('extensions/chrome/manifest.json'));
    const chromeBackground = read(path.join('extensions/chrome', chromeManifest.background.service_worker));
    assert.match(chromeBackground, /import '\.\.\/config\.js';/);
    assert.match(chromeBackground, /import '\.\/utils\.js';/);
    assert.match(chromeBackground, /import '\.\/browser-control-methods\.js';/);

    const firefoxManifest = JSON.parse(read('extensions/firefox/manifest.json'));
    assert.deepEqual(firefoxManifest.background.scripts.slice(0, 4), [
      'config.js',
      'background/utils.js',
      'background/browser-control-methods.js',
      'background/background.js',
    ]);
  });

  it('defines the browser action and sensitive-action contract once', () => {
    assert.equal(new Set(config.SECURITY.allowedActions).size, config.SECURITY.allowedActions.length);
    assert.ok(config.SECURITY.allowedActions.includes('capture_screenshot'));
    assert.ok(config.SECURITY.allowedActions.includes('subscribe_events'));
    for (const action of config.SECURITY.sensitiveActions) {
      assert.ok(config.SECURITY.allowedActions.includes(action));
    }
  });

  it('keeps the Chrome entrypoint free of legacy inline runtime classes', () => {
    const chromeBackground = read('extensions/chrome/background/background.js');
    assert.doesNotMatch(chromeBackground, /^class RateLimiter/m);
    assert.doesNotMatch(chromeBackground, /^class RequestDeduplicator/m);
    assert.doesNotMatch(chromeBackground, /^class RequestQueueManager/m);
    assert.doesNotMatch(chromeBackground, /^class HealthChecker/m);
  });

  it('shares browser-neutral connection, messaging, native-host, and tab methods', () => {
    const methods = sharedBrowserControl.createMethods({});
    for (const name of [
      'saveServerToken',
      'trySyncFromNativeHost',
      'startHeartbeat',
      'sendMessage',
      'resolveRequest',
      'getCookiesByDomain',
      'setupTabListeners',
      'attemptReconnect',
    ]) {
      assert.equal(typeof methods[name], 'function', name);
    }

    const chromeBackground = read('extensions/chrome/background/background.js');
    const firefoxBackground = read('extensions/firefox/background/background.js');
    assert.doesNotMatch(chromeBackground, /^ {2}async saveServerToken\(/m);
    assert.doesNotMatch(firefoxBackground, /^ {2}async saveServerToken\(/m);
    assert.match(chromeBackground, /JSEyesSharedBrowserControl\.createMethods\(chrome\)/);
    assert.match(firefoxBackground, /JSEyesSharedBrowserControl\.createMethods\(browser\)/);
  });

  it('adapts shared token persistence and pending-response cleanup to the injected API', async () => {
    const writes = [];
    const extensionApi = {
      storage: {
        local: {
          set: async (value) => writes.push(['set', value]),
          remove: async (key) => writes.push(['remove', key]),
        },
      },
    };
    const methods = sharedBrowserControl.createMethods(extensionApi);
    const control = {
      ...methods,
      isConnected: false,
      serverToken: null,
      pendingRequests: new Map(),
      queueManager: { remove: (id) => writes.push(['queue', id]) },
      deduplicator: { markCompleted: (id) => writes.push(['dedup', id]) },
    };

    await control.saveServerToken(' token-value ');
    assert.equal(control.serverToken, 'token-value');
    assert.deepEqual(writes.shift(), ['set', { serverToken: 'token-value' }]);

    let response;
    control.pendingRequests.set('req-1', (value) => { response = value; });
    control.resolveRequest('req-1', { ok: true });
    assert.deepEqual(response, { ok: true });
    assert.equal(control.pendingRequests.size, 0);
    assert.deepEqual(writes, [['queue', 'req-1'], ['dedup', 'req-1']]);
  });
});
