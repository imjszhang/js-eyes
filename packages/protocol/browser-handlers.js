'use strict';

const {
  BROWSER_OPERATION_BY_ID,
  BROWSER_OPERATION_BY_MCP_TOOL,
  BROWSER_OPERATION_BY_OPENCLAW_ACTION,
  listBrowserOperationsForProfile,
} = require('./browser-operations');

function resolveOperation(operationOrId) {
  if (operationOrId && typeof operationOrId === 'object' && operationOrId.id) {
    return operationOrId;
  }
  if (typeof operationOrId !== 'string' || !operationOrId) {
    throw new Error('Browser operation id is required');
  }
  const byId = BROWSER_OPERATION_BY_ID[operationOrId];
  if (byId) return byId;
  const byMcp = BROWSER_OPERATION_BY_MCP_TOOL[operationOrId];
  if (byMcp) return byMcp;
  const byOpenclaw = BROWSER_OPERATION_BY_OPENCLAW_ACTION[operationOrId];
  if (byOpenclaw) return byOpenclaw;
  throw new Error(`Unknown browser operation: ${operationOrId}`);
}

function pickOptions(args = {}, callOptions = {}) {
  // Args supply defaults; explicit callOptions (e.g. resolved target) win.
  const options = {};
  if (args.target !== undefined) options.target = args.target;
  if (args.timeout !== undefined) options.timeout = args.timeout;
  if (args.includeSubdomains !== undefined) options.includeSubdomains = args.includeSubdomains;
  if (args.targetSelector !== undefined) options.targetSelector = args.targetSelector;
  if (args.format !== undefined) options.format = args.format;
  if (args.quality !== undefined) options.quality = args.quality;
  if (args.fullPage !== undefined) options.fullPage = args.fullPage;
  return { ...options, ...callOptions };
}

/**
 * Invoke a canonical browser operation against a BrowserAutomation-like client.
 *
 * @param {any} browser client-sdk BrowserAutomation instance (or compatible)
 * @param {string|object} operationOrId operation id, mcp tool name, openclaw action, or operation object
 * @param {any} [args]
 * @param {any} [callOptions] extra SDK options merged after args-derived options
 */
async function invokeBrowserOperation(browser, operationOrId, args = {}, callOptions = {}) {
  if (!browser || typeof browser !== 'object') {
    throw new Error('Browser client is required');
  }
  const operation = resolveOperation(operationOrId);
  const method = operation.sdkMethod;
  if (typeof browser[method] !== 'function') {
    throw new Error(`Browser client does not implement ${method}`);
  }

  const options = pickOptions(args, callOptions);

  switch (operation.id) {
    case 'tabs.list':
      return browser.getTabs(options);
    case 'clients.list':
      return browser.listClients(options);
    case 'url.open':
      return browser.openUrl(
        args.url,
        args.tabId ?? null,
        args.windowId ?? null,
        options,
      );
    case 'tab.close':
      await browser.closeTab(args.tabId, options);
      return { tabId: args.tabId, closed: true, target: options.target };
    case 'page.html':
      return browser.getTabHtml(args.tabId, options);
    case 'script.execute':
      return browser.executeScript(args.tabId, args.code, options);
    case 'style.inject':
      await browser.injectCss(args.tabId, args.css, options);
      return { tabId: args.tabId, injected: true, target: options.target };
    case 'cookies.read':
      return browser.getCookies(args.tabId, options);
    case 'cookies.readDomain':
      return browser.getCookiesByDomain(args.domain, options);
    case 'page.info':
      return browser.getPageInfo(args.tabId, options);
    case 'file.upload':
      return browser.uploadFileToTab(args.tabId, args.files, options);
    case 'screenshot.capture':
      return browser.captureScreenshot(args.tabId, options);
    case 'page.click':
      return browser.click(args.tabId, {
        selector: args.selector,
        text: args.text,
        index: args.index,
      }, options);
    case 'page.fill':
      return browser.fill(args.tabId, {
        selector: args.selector,
        value: args.value,
        clearFirst: args.clearFirst,
        index: args.index,
      }, options);
    case 'page.scroll':
      return browser.scroll(args.tabId, {
        scrollTarget: args.scrollTarget,
        selector: args.selector,
        pixels: args.pixels,
      }, options);
    case 'page.waitFor': {
      // `timeout` on this op is page-wait seconds, not transport timeout.
      const waitSeconds = args.timeout != null ? Number(args.timeout) : undefined;
      const waitOptions = pickOptions({ target: args.target }, callOptions);
      if (waitSeconds != null && Number.isFinite(waitSeconds)) {
        const minTransport = waitSeconds + 5;
        if (waitOptions.timeout == null || Number(waitOptions.timeout) < minTransport) {
          waitOptions.timeout = minTransport;
        }
      }
      return browser.waitFor(args.tabId, {
        selector: args.selector,
        timeout: waitSeconds,
        visible: args.visible,
      }, waitOptions);
    }
    default:
      throw new Error(`No invoke mapping for browser operation: ${operation.id}`);
  }
}

function assertBrowserOperationsComplete() {
  const missing = [];
  for (const operation of listBrowserOperationsForProfile('full')) {
    if (!operation.inputSchema || operation.inputSchema.type !== 'object') {
      missing.push(`${operation.id}:inputSchema`);
    }
    if (!operation.description) missing.push(`${operation.id}:description`);
    if (!Array.isArray(operation.profiles) || operation.profiles.length === 0) {
      missing.push(`${operation.id}:profiles`);
    }
    if (!operation.sdkMethod) missing.push(`${operation.id}:sdkMethod`);
  }
  if (missing.length) {
    throw new Error(`Incomplete browser operations: ${missing.join(', ')}`);
  }
}

module.exports = {
  assertBrowserOperationsComplete,
  invokeBrowserOperation,
  listBrowserOperationsForProfile,
  resolveOperation,
};
