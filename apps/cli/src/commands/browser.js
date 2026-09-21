'use strict';

const { BrowserAutomation } = require('@js-eyes/client-sdk');
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
    case 'cookies':
      if (positionals[2] === 'sync') return commandBrowserCookiesSync(flags);
      throw new Error('支持的命令: `js-eyes browser cookies sync --domain <host> --from <id|name> --to <id|name>`');
    case 'state':
      return commandBrowserState(flags);
    case 'resume':
      return commandBrowserResume(positionals[2] || flags.id, flags);
    case 'downloads':
      return commandBrowserDownloads(flags);
    default:
      throw new Error('支持的命令: `js-eyes browser list|attach|state|resume|downloads|cookies sync`');
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

async function commandBrowserCookiesSync(flags) {
  const domain = flags.domain;
  const source = flags.from;
  const destination = flags.to;
  if (!domain || !source || !destination) {
    throw new Error('用法: js-eyes browser cookies sync --domain x.com --from <id|name> --to <id|name> [--replace]');
  }
  const config = loadConfig();
  const { host, port } = getServerOptions(flags, config);
  const token = readServerToken();
  const browser = new BrowserAutomation(`ws://${host}:${port}`, {
    token,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  try {
    const result = await browser.syncCookies({
      domain,
      source,
      destination,
      includeSubdomains: flags['include-subdomains'] !== false,
      overwrite: flags.replace ? 'replace' : 'merge',
    });
    print(`copied ${result.copied}  skipped ${result.skipped}`);
    for (const reason of result.reasons || []) {
      print(`  ${reason.name || '-'}: ${reason.reason}`);
    }
  } finally {
    browser.disconnect();
  }
}

function createBrowserClient(flags) {
  const config = loadConfig();
  const { host, port } = getServerOptions(flags, config);
  const token = readServerToken();
  return new BrowserAutomation(`ws://${host}:${port}`, {
    token,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
}

async function commandBrowserState(flags) {
  const tabId = flags['tab-id'] || flags.tabId;
  if (!tabId) throw new Error('用法: js-eyes browser state --tab-id <id>');
  const browser = createBrowserClient(flags);
  try {
    const result = await browser.getPageState(tabId, {
      maxElements: flags['max-elements'] ? Number(flags['max-elements']) : undefined,
      interactiveOnly: flags['interactive-only'] !== false,
    });
    print(JSON.stringify({
      url: result && result.url,
      title: result && result.title,
      generation: result && result.generation,
      elements: ((result && result.elements) || []).map((el) => ({
        ref: el.ref,
        tag: el.tag,
        role: el.role,
        name: el.name,
        nth: el.nth,
      })),
    }, null, 2));
  } finally {
    browser.disconnect();
  }
}

async function commandBrowserResume(pendingId, flags = {}) {
  if (!pendingId) throw new Error('用法: js-eyes browser resume <pendingId>');
  const config = loadConfig();
  const { host, port } = getServerOptions(flags, config);
  const token = readServerToken();
  const payload = await fetchJson(
    `http://${host}:${port}/api/browser/pending-user/${encodeURIComponent(pendingId)}/resume`,
    { token, host, method: 'POST', body: {} },
  );
  print(payload.resumed ? `resumed ${pendingId}` : `pending user not found: ${pendingId}`);
}

async function commandBrowserDownloads(flags) {
  const browser = createBrowserClient(flags);
  try {
    const result = await browser.listDownloads();
    const items = (result && result.downloads) || [];
    if (items.length === 0) {
      print('No downloads.');
      return;
    }
    for (const item of items) {
      print([item.id, item.state, item.basename, item.bytes, item.urlHost].join('  '));
    }
  } finally {
    browser.disconnect();
  }
}

module.exports = {
  commandBrowser,
  commandBrowserAttach,
  commandBrowserCookiesSync,
  commandBrowserDownloads,
  commandBrowserList,
  commandBrowserResume,
  commandBrowserState,
  loadBrowserConfig,
};
