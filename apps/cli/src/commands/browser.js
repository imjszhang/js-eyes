'use strict';

const {
  fetchJson,
  getServerOptions,
  loadConfig,
  mergeBrowserConfig,
  print,
  readServerToken,
  setConfigValue,
} = require('../command-context');

function loadBrowserConfig(config) {
  try {
    return mergeBrowserConfig(config.browser);
  } catch {
    return config.browser || {};
  }
}

async function commandBrowser(positionals, flags = {}) {
  const action = positionals[1];
  switch (action) {
    case 'list':
      return commandBrowserList(flags);
    case 'attach':
      return commandBrowserAttach(flags);
    default:
      throw new Error('支持的命令: `js-eyes browser list` / `js-eyes browser attach --cdp|--bidi`');
  }
}

async function commandBrowserList(flags) {
  const config = loadConfig();
  const { host, port } = getServerOptions(flags, config);
  const token = readServerToken();
  const payload = await fetchJson(`http://${host}:${port}/api/browser/clients`, { token, host });
  const clients = payload.clients || [];
  if (clients.length === 0) {
    print('No browser clients connected.');
    return;
  }
  for (const client of clients) {
    print([
      client.clientId,
      client.kind || 'extension',
      client.browserName || 'unknown',
      `${client.tabCount || 0} tabs`,
    ].join('  '));
  }
}

function commandBrowserAttach(flags) {
  if (!flags.cdp && !flags.bidi) {
    throw new Error('用法: js-eyes browser attach --cdp [--mode attach|endpoint|launch] [--endpoint url] 或 --bidi [--endpoint url]');
  }
  if (flags.cdp) {
    const mode = flags.mode || 'attach';
    if (!['attach', 'endpoint', 'launch'].includes(mode)) {
      throw new Error('CDP mode 必须是 attach、endpoint 或 launch');
    }
    setConfigValue('browser.transports.cdp.enabled', true);
    setConfigValue('browser.transports.cdp.mode', mode);
    if (flags.endpoint) setConfigValue('browser.transports.cdp.endpoint', flags.endpoint);
    if (flags.channel) setConfigValue('browser.transports.cdp.channel', flags.channel);
    print('已写入 browser.transports.cdp。重启 js-eyes server 后生效。');
    return;
  }
  setConfigValue('browser.transports.bidi.enabled', true);
  if (flags.endpoint) setConfigValue('browser.transports.bidi.endpoint', flags.endpoint);
  print('已写入 browser.transports.bidi。重启 js-eyes server 后生效。');
}

module.exports = {
  commandBrowser,
  commandBrowserAttach,
  commandBrowserList,
  loadBrowserConfig,
};
