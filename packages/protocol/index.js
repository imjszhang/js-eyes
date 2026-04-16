'use strict';

const pkg = require('./package.json');

const DEFAULT_SERVER_HOST = 'localhost';
const DEFAULT_SERVER_PORT = 18080;
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 60;
const REQUEST_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_SECONDS * 1000;
const PROTOCOL_VERSION = '1.0';
const PACKAGE_VERSION = pkg.version;
const SKILLS_REGISTRY_URL = 'https://js-eyes.com/skills.json';
const RELEASE_BASE_URL = 'https://github.com/imjszhang/js-eyes/releases/download';

const FORWARDABLE_ACTIONS = [
  'open_url',
  'close_tab',
  'get_html',
  'execute_script',
  'inject_css',
  'get_cookies',
  'get_cookies_by_domain',
  'get_page_info',
  'upload_file_to_tab',
];

const COMPATIBILITY_MATRIX = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  cliVersion: PACKAGE_VERSION,
  extensionVersion: PACKAGE_VERSION,
  serverCoreVersion: PACKAGE_VERSION,
  clientSdkVersion: PACKAGE_VERSION,
  openclawPluginVersion: PACKAGE_VERSION,
  skillClientSdkVersion: PACKAGE_VERSION,
});

module.exports = {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  DEFAULT_REQUEST_TIMEOUT_SECONDS,
  REQUEST_TIMEOUT_MS,
  PROTOCOL_VERSION,
  PACKAGE_VERSION,
  SKILLS_REGISTRY_URL,
  RELEASE_BASE_URL,
  FORWARDABLE_ACTIONS,
  COMPATIBILITY_MATRIX,
};
