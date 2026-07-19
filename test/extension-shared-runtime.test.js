'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const config = require('../extensions/shared/config');
const sharedBrowserControl = require('../extensions/shared/browser-control-methods');
const methodModuleNames = ['connection', 'messaging', 'operations', 'routing', 'tabs'];
const platformModuleNames = ['connection', 'server', 'operations', 'runtime', 'tabs'];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('extension shared runtime contract', () => {
  it('keeps generated platform copies byte-identical to the shared source', () => {
    assert.equal(read('extensions/chrome/config.js'), read('extensions/shared/config.js'));
    assert.equal(read('extensions/firefox/config.js'), read('extensions/shared/config.js'));
    assert.equal(read('extensions/chrome/background/utils.js'), read('extensions/shared/utils.js'));
    assert.equal(read('extensions/firefox/background/utils.js'), read('extensions/shared/utils.js'));
    for (const name of methodModuleNames) {
      assert.equal(read(`extensions/chrome/background/${name}-methods.js`), read(`extensions/shared/${name}-methods.js`));
      assert.equal(read(`extensions/firefox/background/${name}-methods.js`), read(`extensions/shared/${name}-methods.js`));
    }
    assert.equal(read('extensions/chrome/background/browser-control-methods.js'), read('extensions/shared/browser-control-methods.js'));
    assert.equal(read('extensions/firefox/background/browser-control-methods.js'), read('extensions/shared/browser-control-methods.js'));
  });

  it('loads shared files before each platform background entrypoint', () => {
    const chromeManifest = JSON.parse(read('extensions/chrome/manifest.json'));
    const chromeBackground = read(path.join('extensions/chrome', chromeManifest.background.service_worker));
    assert.match(chromeBackground, /import '\.\.\/config\.js';/);
    assert.match(chromeBackground, /import '\.\/utils\.js';/);
    for (const name of methodModuleNames) {
      assert.match(chromeBackground, new RegExp(`import '\\.\\/${name}-methods\\.js';`));
    }
    assert.match(chromeBackground, /import '\.\/browser-control-methods\.js';/);

    const firefoxManifest = JSON.parse(read('extensions/firefox/manifest.json'));
    assert.deepEqual(firefoxManifest.background.scripts, [
      'config.js',
      'background/utils.js',
      'background/connection-methods.js',
      'background/messaging-methods.js',
      'background/operations-methods.js',
      'background/routing-methods.js',
      'background/tabs-methods.js',
      'background/browser-control-methods.js',
      'background/platform-connection-methods.js',
      'background/platform-server-methods.js',
      'background/platform-operations-methods.js',
      'background/platform-runtime-methods.js',
      'background/platform-tabs-methods.js',
      'background/background.js',
    ]);
  });

  it('loads Firefox background dependencies in one classic-script scope', () => {
    const firefoxManifest = JSON.parse(read('extensions/firefox/manifest.json'));
    const context = vm.createContext({ console });
    const dependencyScripts = firefoxManifest.background.scripts.slice(0, -1);

    for (const relativePath of dependencyScripts) {
      vm.runInContext(read(path.join('extensions/firefox', relativePath)), context, {
        filename: relativePath,
      });
    }

    for (const globalName of [
      'JSEyesConnectionMethods',
      'JSEyesMessagingMethods',
      'JSEyesBrowserOperationMethods',
      'JSEyesRuntimeRoutingMethods',
      'JSEyesTabSyncMethods',
      'JSEyesSharedBrowserControl',
      'JSEyesPlatformConnectionMethods',
      'JSEyesPlatformServerMethods',
      'JSEyesPlatformOperationsMethods',
      'JSEyesPlatformRuntimeMethods',
      'JSEyesPlatformTabsMethods',
    ]) {
      assert.equal(typeof context[globalName]?.createMethods, 'function', globalName);
    }
  });

  it('keeps the Firefox popup connection-status message contract', () => {
    let listener;
    const previousBrowser = globalThis.browser;
    globalThis.browser = {
      runtime: {
        id: 'js-eyes-test',
        onMessage: {
          addListener(callback) {
            listener = callback;
          },
        },
      },
    };

    try {
      const runtimeMethods = require('../extensions/firefox/background/platform-runtime-methods').createMethods();
      const control = {
        ...runtimeMethods,
        isConnected: false,
        serverUrl: 'ws://localhost:18080',
        reconnectAttempts: 0,
      };
      control.setupMessageListeners();

      let response;
      const keepsChannelOpen = listener(
        { type: 'get_connection_status' },
        { id: 'js-eyes-test' },
        (value) => { response = value; },
      );

      assert.equal(keepsChannelOpen, true);
      assert.deepEqual(response, {
        isConnected: false,
        serverUrl: 'ws://localhost:18080',
        reconnectAttempts: 0,
      });
    } finally {
      if (previousBrowser === undefined) delete globalThis.browser;
      else globalThis.browser = previousBrowser;
    }
  });

  it('keeps the compatibility facade thin and each method module bounded', () => {
    assert.ok(read('extensions/shared/browser-control-methods.js').split('\n').length <= 50);
    for (const name of methodModuleNames) {
      const source = read(`extensions/shared/${name}-methods.js`);
      assert.ok(source.split('\n').length <= 500, name);
      assert.doesNotMatch(source, /browser-control-methods/);
    }
  });

  it('preserves the complete shared method surface', () => {
    assert.deepEqual(Object.keys(sharedBrowserControl.createMethods({})), [
      'startCleanupTask', 'broadcastStatusUpdate', 'saveServerToken', 'trySyncFromNativeHost',
      '_cleanupSocket', 'startHeartbeat', 'stopHeartbeat', 'attemptReconnect',
      'resetReconnectCounter', 'stopAutoReconnect', 'sendRawMessage', 'sendMessage',
      'generateRequestId', 'resolveRequest', 'sendHtmlInChunks', 'handleCloseTab',
      'handleGetCookies', 'handleGetCookiesByDomain', 'handleGetPageInfo', 'getCookiesByDomain',
      'getTabCookies', 'deduplicateCookies', 'validateCookies', 'analyzeCookieDomains',
      'waitForTabLoad', 'handleContentScriptRequest', 'handleGetTabsRequest',
      'handleOpenUrlRequest', 'handleCloseTabRequest', 'handleGetCookiesRequest',
      'handleGetCookiesByDomainRequest', 'handleGetPageInfoRequest', 'debouncedSendTabsData',
      'setupTabListeners', 'startTabDataSync',
    ]);
  });

  it('preserves each platform method surface after extraction', () => {
    globalThis.EXTENSION_CONFIG = { SECURITY: {} };
    globalThis.ExtensionUtils = {
      RateLimiter: class {},
      RequestDeduplicator: class {},
      RequestQueueManager: class {},
      HealthChecker: class {},
    };
    const expected = {
      connection: [
        'initStabilityTools', 'discoverServer', '_applyFallbackDiscovery', 'initHealthChecker',
        'getExtendedStatus', 'canSendRequest', 'loadSettings', 'nativeMessagingRequest', 'connect',
        'handleAuthResult', 'syncServerConfig', 'applyServerConfig', 'reconnectWithNewSettings',
      ],
      server: ['handleMessage', 'handleServerResponse', 'handleServerRateLimit'],
      operations: [
        'handleOpenUrl', 'handleGetHtml', 'handleExecuteScript', 'handleInjectCss',
        'handleUploadFileToTab', 'handleCaptureScreenshot', 'generateFileUploadScript',
      ],
      runtime: [
        'setupMessageListeners', 'validateSensitiveOperation', 'handleGetHtmlRequest',
        'handleExecuteScriptRequest', 'handleInjectCssRequest', 'handleUploadFileRequest',
        'handleSubscribeEvents', 'handleUnsubscribeEvents',
      ],
      tabs: ['sendTabsData'],
    };
    const firefoxExpected = {
      server: ['sendNotification', ...expected.server],
      operations: [
        'handleOpenUrl', 'handleGetHtml', 'handleExecuteScript', 'handleInjectCss',
        'handleUploadFileToTab', 'handleCaptureScreenshot', 'captureFullPageScreenshot',
        'getScreenshotPageMetrics', 'scrollScreenshotTabTo', 'loadScreenshotImage', 'delay',
        'generateFileUploadScript',
      ],
    };

    for (const platform of ['chrome', 'firefox']) {
      for (const name of platformModuleNames) {
        const modulePath = `../extensions/${platform}/background/platform-${name}-methods`;
        const methods = require(modulePath).createMethods();
        const names = Object.keys(methods);
        const platformExpected = platform === 'firefox' && firefoxExpected[name]
          ? firefoxExpected[name]
          : expected[name];
        assert.deepEqual(names, platformExpected, `${platform}/${name}`);
      }
    }
  });

  it('keeps platform entrypoints focused on construction and startup', () => {
    for (const platform of ['chrome', 'firefox']) {
      const entrypoint = read(`extensions/${platform}/background/background.js`);
      assert.ok(entrypoint.split('\n').length <= 300, platform);
      for (const name of platformModuleNames) {
        const moduleSource = read(`extensions/${platform}/background/platform-${name}-methods.js`);
        assert.ok(moduleSource.split('\n').length <= 750, `${platform}/${name}`);
        if (platform === 'chrome') {
          assert.match(entrypoint, new RegExp(`platform-${name}-methods\\.js`));
        }
      }
      assert.doesNotMatch(entrypoint, /^ {2}(async )?connect\(/m);
      assert.doesNotMatch(entrypoint, /^ {2}(async )?handleMessage\(/m);
      assert.doesNotMatch(entrypoint, /^ {2}(async )?setupMessageListeners\(/m);
    }
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
