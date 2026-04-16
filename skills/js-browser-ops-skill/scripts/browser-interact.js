#!/usr/bin/env node
'use strict';

const { BrowserAutomation } = require('../lib/js-eyes-client');
const { clickElement, fillForm, waitFor, scrollPage } = require('../lib/api');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    action: null,
    tabId: null,
    selector: null,
    value: null,
    text: null,
    target: null,
    pixels: null,
    timeout: null,
    visible: false,
    clearFirst: false,
    index: 0,
    pretty: false,
    browserServer: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--pretty') {
      options.pretty = true;
    } else if (arg === '--tab-id' && args[i + 1]) {
      options.tabId = parseInt(args[i + 1], 10);
      i += 1;
    } else if (arg === '--selector' && args[i + 1]) {
      options.selector = args[i + 1];
      i += 1;
    } else if (arg === '--value' && args[i + 1]) {
      options.value = args[i + 1];
      i += 1;
    } else if (arg === '--text' && args[i + 1]) {
      options.text = args[i + 1];
      i += 1;
    } else if (arg === '--target' && args[i + 1]) {
      options.target = args[i + 1];
      i += 1;
    } else if (arg === '--pixels' && args[i + 1]) {
      options.pixels = parseInt(args[i + 1], 10);
      i += 1;
    } else if (arg === '--timeout' && args[i + 1]) {
      options.timeout = parseInt(args[i + 1], 10);
      i += 1;
    } else if (arg === '--index' && args[i + 1]) {
      options.index = parseInt(args[i + 1], 10);
      i += 1;
    } else if (arg === '--visible') {
      options.visible = true;
    } else if (arg === '--clear-first') {
      options.clearFirst = true;
    } else if (arg === '--browser-server' && args[i + 1]) {
      options.browserServer = args[i + 1];
      i += 1;
    } else if (!options.action) {
      options.action = arg;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();
  if (!options.action || options.action === '--help' || options.action === '-h') {
    console.log('用法: node index.js interact <action> --tab-id <id> [options]');
    console.log('');
    console.log('Actions:');
    console.log('  click   --tab-id <id> --selector <sel> [--text <text>] [--index <n>]');
    console.log('  fill    --tab-id <id> --selector <sel> --value <val> [--clear-first]');
    console.log('  wait    --tab-id <id> --selector <sel> [--timeout <sec>] [--visible]');
    console.log('  scroll  --tab-id <id> [--target top|bottom] [--selector <sel>] [--pixels <n>]');
    return;
  }

  if (!options.tabId) {
    throw new Error('必须提供 --tab-id');
  }

  const runtimeConfig = resolveRuntimeConfig({
    browserServer: options.browserServer || process.env.JS_EYES_WS_URL,
  });

  const browser = new BrowserAutomation(runtimeConfig.serverUrl);
  try {
    let result;
    switch (options.action) {
      case 'click':
        result = await clickElement(browser, {
          tabId: options.tabId,
          selector: options.selector,
          text: options.text,
          index: options.index,
        });
        break;
      case 'fill':
        result = await fillForm(browser, {
          tabId: options.tabId,
          selector: options.selector,
          value: options.value,
          clearFirst: options.clearFirst,
          index: options.index,
        });
        break;
      case 'wait':
        result = await waitFor(browser, {
          tabId: options.tabId,
          selector: options.selector,
          timeout: options.timeout,
          visible: options.visible,
        });
        break;
      case 'scroll':
        result = await scrollPage(browser, {
          tabId: options.tabId,
          target: options.target,
          selector: options.selector,
          pixels: options.pixels,
        });
        break;
      default:
        throw new Error(`未知操作: ${options.action}`);
    }
    console.log(JSON.stringify(result, null, options.pretty ? 2 : 0));
  } finally {
    browser.disconnect();
  }
}

module.exports = { main, parseArgs };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
