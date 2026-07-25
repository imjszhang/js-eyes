'use strict';

/**
 * Canonical browser-operation metadata.
 *
 * Host-specific descriptions, validation libraries, and result formatting stay
 * with their host. Names, routing, permissions, and policy identity live here.
 */
const BROWSER_OPERATIONS = Object.freeze([
  {
    id: 'tabs.list',
    wireAction: 'get_tabs',
    sdkMethod: 'getTabs',
    openclawAction: 'browser/get-tabs',
    mcpTool: 'browser_list_tabs',
    capability: 'browser.tabs.read',
    risk: 'read',
    routing: 'server',
  },
  {
    id: 'clients.list',
    wireAction: 'list_clients',
    sdkMethod: 'listClients',
    openclawAction: 'browser/list-clients',
    mcpTool: 'browser_list_clients',
    capability: 'browser.tabs.read',
    risk: 'read',
    routing: 'server',
  },
  {
    id: 'url.open',
    wireAction: 'open_url',
    sdkMethod: 'openUrl',
    policyTool: 'openUrl',
    openclawAction: 'browser/open-url',
    mcpTool: 'browser_open_url',
    capability: 'browser.navigation',
    risk: 'interactive',
    routing: 'extension',
  },
  {
    id: 'tab.close',
    wireAction: 'close_tab',
    sdkMethod: 'closeTab',
    openclawAction: 'browser/close-tab',
    mcpTool: 'browser_close_tab',
    capability: 'browser.navigation',
    risk: 'interactive',
    routing: 'extension',
  },
  {
    id: 'page.html',
    wireAction: 'get_html',
    sdkMethod: 'getTabHtml',
    openclawAction: 'browser/get-html',
    mcpTool: 'browser_get_html',
    capability: 'browser.page.read',
    risk: 'read',
    routing: 'extension',
  },
  {
    id: 'script.execute',
    wireAction: 'execute_script',
    sdkMethod: 'executeScript',
    policyTool: 'executeScript',
    openclawAction: 'browser/execute-script',
    mcpTool: 'browser_execute_script',
    capability: 'browser.script.execute',
    risk: 'destructive',
    routing: 'extension',
    sensitive: true,
  },
  {
    id: 'style.inject',
    wireAction: 'inject_css',
    sdkMethod: 'injectCss',
    policyTool: 'injectCss',
    openclawAction: 'browser/inject-css',
    mcpTool: 'browser_inject_css',
    capability: 'browser.css.inject',
    risk: 'interactive',
    routing: 'extension',
    sensitive: true,
  },
  {
    id: 'cookies.read',
    wireAction: 'get_cookies',
    sdkMethod: 'getCookies',
    policyTool: 'getCookies',
    openclawAction: 'browser/get-cookies',
    mcpTool: 'browser_get_cookies',
    capability: 'browser.cookies.read',
    risk: 'read',
    routing: 'extension',
    sensitive: true,
  },
  {
    id: 'cookies.readDomain',
    wireAction: 'get_cookies_by_domain',
    sdkMethod: 'getCookiesByDomain',
    policyTool: 'getCookiesByDomain',
    openclawAction: 'browser/get-cookies-by-domain',
    mcpTool: 'browser_get_cookies_by_domain',
    capability: 'browser.cookies.read',
    risk: 'read',
    routing: 'extension',
    sensitive: true,
  },
  {
    id: 'page.info',
    wireAction: 'get_page_info',
    sdkMethod: 'getPageInfo',
    openclawAction: 'browser/get-page-info',
    mcpTool: 'browser_get_page_info',
    capability: 'browser.page.read',
    risk: 'read',
    routing: 'extension',
  },
  {
    id: 'file.upload',
    wireAction: 'upload_file_to_tab',
    sdkMethod: 'uploadFileToTab',
    policyTool: 'uploadFileToTab',
    openclawAction: 'browser/upload-file',
    mcpTool: 'browser_upload_file',
    capability: 'browser.files.upload',
    risk: 'destructive',
    routing: 'extension',
    sensitive: true,
  },
  {
    id: 'screenshot.capture',
    wireAction: 'capture_screenshot',
    sdkMethod: 'captureScreenshot',
    mcpTool: 'browser_take_screenshot',
    capability: 'browser.screenshot',
    risk: 'read',
    routing: 'extension',
  },
].map((operation) => Object.freeze(operation)));

const BROWSER_OPERATION_BY_WIRE_ACTION = Object.freeze(Object.fromEntries(
  BROWSER_OPERATIONS.map((operation) => [operation.wireAction, operation]),
));

const BROWSER_OPERATION_BY_ID = Object.freeze(Object.fromEntries(
  BROWSER_OPERATIONS.map((operation) => [operation.id, operation]),
));

const BROWSER_OPERATION_BY_OPENCLAW_ACTION = Object.freeze(Object.fromEntries(
  BROWSER_OPERATIONS
    .filter((operation) => operation.openclawAction)
    .map((operation) => [operation.openclawAction, operation]),
));

const BROWSER_OPERATION_BY_MCP_TOOL = Object.freeze(Object.fromEntries(
  BROWSER_OPERATIONS
    .filter((operation) => operation.mcpTool)
    .map((operation) => [operation.mcpTool, operation]),
));

const FORWARDABLE_ACTIONS = Object.freeze(BROWSER_OPERATIONS
  .filter((operation) => operation.routing === 'extension')
  .map((operation) => operation.wireAction));

const SENSITIVE_BROWSER_ACTIONS = Object.freeze(BROWSER_OPERATIONS
  .filter((operation) => operation.sensitive)
  .map((operation) => operation.wireAction));

const SENSITIVE_BROWSER_TOOL_NAMES = Object.freeze(BROWSER_OPERATIONS
  .filter((operation) => operation.sensitive && operation.openclawAction)
  .map((operation) => operation.openclawAction));

const ACTION_POLICY_TOOL_MAP = Object.freeze(Object.fromEntries(
  BROWSER_OPERATIONS
    .filter((operation) => operation.policyTool)
    .map((operation) => [operation.wireAction, operation.policyTool]),
));

module.exports = {
  ACTION_POLICY_TOOL_MAP,
  BROWSER_OPERATIONS,
  BROWSER_OPERATION_BY_ID,
  BROWSER_OPERATION_BY_MCP_TOOL,
  BROWSER_OPERATION_BY_OPENCLAW_ACTION,
  BROWSER_OPERATION_BY_WIRE_ACTION,
  FORWARDABLE_ACTIONS,
  SENSITIVE_BROWSER_ACTIONS,
  SENSITIVE_BROWSER_TOOL_NAMES,
};
