'use strict';

function resolveMethodModules() {
  if (typeof module !== 'undefined' && module.exports) {
    return [
    require('./connection-methods'),
    require('./messaging-methods'),
    require('./operations-methods'),
    require('./routing-methods'),
    require('./tabs-methods'),
    ];
  }
  return [
    globalThis.JSEyesConnectionMethods,
    globalThis.JSEyesMessagingMethods,
    globalThis.JSEyesBrowserOperationMethods,
    globalThis.JSEyesRuntimeRoutingMethods,
    globalThis.JSEyesTabSyncMethods,
  ];
}

function createMethods(extensionApi) {
  if (!extensionApi) throw new TypeError('extensionApi is required');
  return Object.assign({}, ...resolveMethodModules().map((methods) => methods.createMethods(extensionApi)));
}

const sharedBrowserControl = { createMethods };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sharedBrowserControl;
}
globalThis.JSEyesSharedBrowserControl = sharedBrowserControl;
