'use strict';

const crypto = require('crypto');
const path = require('path');
const { BrowserAutomation } = require('@js-eyes/client-sdk');
const { loadConfig, mergeRecordingConfig } = require('@js-eyes/config');
const { createSkillRunContext } = require('@js-eyes/skill-recording');
const { ensureDir, getPaths } = require('@js-eyes/runtime-paths');
const {
  SkillCancelledError,
  SkillCapabilityError,
  SkillDisposedError,
  SkillTimeoutError,
} = require('./errors');

const BROWSER_METHOD_CAPABILITIES = Object.freeze({
  getTabs: 'browser.tabs.read',
  listClients: 'browser.tabs.read',
  openUrl: 'browser.navigation',
  closeTab: 'browser.navigation',
  getTabHtml: 'browser.page.read',
  getPageInfo: 'browser.page.read',
  captureScreenshot: 'browser.screenshot',
  executeScript: 'browser.script.execute',
  injectCss: 'browser.css.inject',
  getCookies: 'browser.cookies.read',
  getCookiesByDomain: 'browser.cookies.read',
  uploadFileToTab: 'browser.files.upload',
});

function noop() {}

function makeLogger(candidate, fields = {}) {
  const base = candidate || console;
  function bind(level) {
    const fn = typeof base[level] === 'function' ? base[level].bind(base) : noop;
    return (...args) => {
      if (Object.keys(fields).length === 0) return fn(...args);
      return fn(`[js-eyes][skill] ${JSON.stringify(fields)}`, ...args);
    };
  }
  return Object.freeze({ info: bind('info'), warn: bind('warn'), error: bind('error') });
}

function loadGlobalConfigSafely(loader) {
  try {
    return (loader || loadConfig)();
  } catch {
    return {};
  }
}

function resolveServerUrl(globalConfig, overrides = {}) {
  return overrides.jsEyesServerUrl
    || overrides.browserServer
    || overrides.serverUrl
    || `ws://${globalConfig.serverHost || 'localhost'}:${globalConfig.serverPort || 18080}`;
}

function normalizeCapabilitySet(value) {
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

function createSkillRuntime(options = {}) {
  const descriptor = options.descriptor || {};
  if (!descriptor.id) throw new TypeError('createSkillRuntime requires descriptor.id');

  const globalConfig = loadGlobalConfigSafely(options.configLoader);
  const skillConfig = Object.freeze({ ...(options.skillConfig || {}) });
  const config = Object.freeze({
    ...skillConfig,
    serverUrl: resolveServerUrl(globalConfig, skillConfig),
    requestTimeout: Number(skillConfig.requestTimeout || globalConfig.requestTimeout || 1800),
    recording: Object.freeze(mergeRecordingConfig(globalConfig.recording, skillConfig.recording)),
  });
  const logger = makeLogger(options.logger, { skillId: descriptor.id });
  const grantedCapabilities = normalizeCapabilitySet(options.grantedCapabilities);
  const runtimePaths = options.runtimePaths || getPaths(options.pathOptions);
  const encodedId = encodeURIComponent(descriptor.id).replace(/%/g, '_');
  const storageRoot = path.join(runtimePaths.baseDir, 'skill-data', encodedId);
  const storage = Object.freeze({
    root: storageRoot,
    cache: path.join(storageRoot, 'cache'),
    history: path.join(storageRoot, 'history'),
    debug: path.join(storageRoot, 'debug'),
    state: path.join(storageRoot, 'state'),
    downloads: path.join(storageRoot, 'downloads'),
    tmp: path.join(storageRoot, 'tmp'),
  });

  let browser = null;
  let scopedBrowser = null;
  let state = 'active';
  let disposePromise = null;
  const disposables = [];
  const activeInvocations = new Map();
  const browserFactory = options.browserFactory || ((url, browserOptions) => new BrowserAutomation(url, browserOptions));

  function assertActive() {
    if (state !== 'active') throw new SkillDisposedError();
  }

  function hasCapability(capability) {
    return grantedCapabilities.has('*') || grantedCapabilities.has(capability);
  }

  function requireCapability(capability) {
    if (!hasCapability(capability)) throw new SkillCapabilityError(capability);
  }

  function getBrowser() {
    assertActive();
    if (!browser) {
      browser = browserFactory(config.serverUrl, {
        defaultTimeout: config.requestTimeout,
        logger,
      });
    }
    return browser;
  }

  function createScopedBrowser(requireGranted, hasBrowserGrant) {
    return new Proxy({}, {
      get(_target, property) {
        if (typeof property !== 'string') return undefined;
        if (property === 'serverUrl') return getBrowser().serverUrl;
        if (property === 'logger') return logger;
        if (property === 'connect') {
          return () => {
            if (!hasBrowserGrant()) throw new SkillCapabilityError('browser');
            return getBrowser().connect();
          };
        }
        if (property === 'disconnect') return () => {};
        const capability = BROWSER_METHOD_CAPABILITIES[property];
        if (!capability) return undefined;
        return (...args) => {
          requireGranted(capability);
          const client = getBrowser();
          if (typeof client[property] !== 'function') {
            throw new TypeError(`Browser method is unavailable: ${property}`);
          }
          return client[property](...args);
        };
      },
    });
  }

  function getScopedBrowser() {
    assertActive();
    if (!scopedBrowser) {
      scopedBrowser = createScopedBrowser(
        requireCapability,
        () => [...grantedCapabilities].some((item) => item === '*' || item.startsWith('browser.')),
      );
    }
    return scopedBrowser;
  }

  function registerDisposable(disposable) {
    assertActive();
    if (typeof disposable !== 'function' && typeof disposable?.dispose !== 'function') {
      throw new TypeError('disposable must be a function or expose dispose()');
    }
    disposables.push(disposable);
    return disposable;
  }

  function ensureStorage() {
    for (const value of Object.values(storage)) ensureDir(value);
    return storage;
  }

  function createInvocation(invocationOptions = {}) {
    assertActive();
    const invocationId = invocationOptions.invocationId
      || invocationOptions.toolCallId
      || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    const timeoutMs = Number(invocationOptions.timeoutMs || config.requestTimeout * 1000);
    const startedAtMs = Date.now();
    const controller = new AbortController();
    const externalSignal = invocationOptions.signal;
    const onExternalAbort = () => controller.abort(externalSignal.reason || new SkillCancelledError());
    if (externalSignal) {
      if (externalSignal.aborted) onExternalAbort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => controller.abort(new SkillTimeoutError(undefined, { timeoutMs })), timeoutMs)
      : null;
    const invocationLogger = makeLogger(options.logger, {
      skillId: descriptor.id,
      toolName: invocationOptions.toolName || 'unknown',
      invocationId,
    });
    const recording = createSkillRunContext({
      skillId: descriptor.id,
      skillVersion: descriptor.version,
      toolName: invocationOptions.toolName,
      input: invocationOptions.input,
      runId: invocationId,
      recording: config.recording,
    });

    let finished = false;
    const declaredToolCapabilities = invocationOptions.capabilities == null
      ? null
      : new Set(invocationOptions.capabilities);
    const invocationHasCapability = (capability) => hasCapability(capability)
      && (declaredToolCapabilities == null
        || declaredToolCapabilities.has('*')
        || declaredToolCapabilities.has(capability));
    const invocationRequireCapability = (capability) => {
      if (!invocationHasCapability(capability)) throw new SkillCapabilityError(capability);
    };
    const invocationBrowser = createScopedBrowser(
      invocationRequireCapability,
      () => [...grantedCapabilities].some((item) => (
        (item === '*' || item.startsWith('browser.'))
        && (declaredToolCapabilities == null
          || declaredToolCapabilities.has('*')
          || declaredToolCapabilities.has(item))
      )),
    );
    function finish() {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
      activeInvocations.delete(invocationId);
    }

    const context = Object.freeze({
      invocationId,
      toolCallId: invocationOptions.toolCallId || invocationId,
      skillId: descriptor.id,
      toolName: invocationOptions.toolName || 'unknown',
      source: invocationOptions.source || 'unknown',
      target: invocationOptions.target || null,
      risk: invocationOptions.risk || 'read',
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      deadline: Number.isFinite(timeoutMs) && timeoutMs > 0 ? startedAtMs + timeoutMs : null,
      signal: controller.signal,
      logger: invocationLogger,
      config,
      storage,
      recording,
      capabilities: Object.freeze({ has: invocationHasCapability, require: invocationRequireCapability }),
      get browser() { return invocationBrowser; },
      finish,
    });
    activeInvocations.set(invocationId, { context, controller, finish });
    return context;
  }

  async function invoke(tool, input, invocationOptions = {}) {
    if (!tool || typeof tool.execute !== 'function') throw new TypeError('tool.execute is required');
    const context = createInvocation({
      ...invocationOptions,
      toolName: tool.name,
      risk: tool.risk,
      capabilities: tool.capabilities,
      input,
    });
    const active = activeInvocations.get(context.invocationId);
    const execution = Promise.resolve().then(() => tool.execute(context, input || {}));
    const settledExecution = execution.finally(() => context.finish());
    settledExecution.catch(() => {});
    if (active) active.done = settledExecution;
    let onAbort;
    const aborted = new Promise((_resolve, reject) => {
      onAbort = () => reject(context.signal.reason || new SkillCancelledError());
      if (context.signal.aborted) onAbort();
      else context.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([settledExecution, aborted]);
    } finally {
      context.signal.removeEventListener('abort', onAbort);
    }
  }

  async function dispose() {
    if (disposePromise) return disposePromise;
    state = 'disposing';
    disposePromise = (async () => {
      const draining = [];
      for (const active of activeInvocations.values()) {
        active.controller.abort(new SkillCancelledError('Skill runtime is disposing'));
        if (active.done) draining.push(active.done.catch(() => {}));
        else active.finish();
      }
      if (draining.length > 0) {
        const graceMs = Number(options.disposeGraceMs || 5000);
        let graceTimer;
        await Promise.race([
          Promise.allSettled(draining),
          new Promise((resolve) => { graceTimer = setTimeout(resolve, graceMs); }),
        ]);
        if (graceTimer) clearTimeout(graceTimer);
      }
      const cleanup = disposables.splice(0).reverse();
      const ownedBrowser = browser;
      if (ownedBrowser && options.disposeBrowser !== false) cleanup.push(() => ownedBrowser.disconnect?.());
      browser = null;
      scopedBrowser = null;
      const errors = [];
      for (const disposable of cleanup) {
        try {
          if (typeof disposable === 'function') await disposable();
          else await disposable.dispose();
        } catch (error) {
          errors.push(error);
          logger.warn(`dispose failed: ${error.message}`);
        }
      }
      state = 'disposed';
      return { errors };
    })();
    return disposePromise;
  }

  return Object.freeze({
    descriptor,
    config,
    logger,
    storage,
    ensureStorage,
    getBrowser,
    getScopedBrowser,
    hasCapability,
    requireCapability,
    registerDisposable,
    createInvocation,
    invoke,
    dispose,
    get state() { return state; },
    get activeInvocationCount() { return activeInvocations.size; },
  });
}

module.exports = {
  BROWSER_METHOD_CAPABILITIES,
  createSkillRuntime,
  makeLogger,
  resolveServerUrl,
};
