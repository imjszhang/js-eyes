#!/usr/bin/env node
'use strict';

const { BrowserAutomation } = require('../lib/js-eyes-client');
const { getAnswer } = require('../lib/api');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { url: null, pretty: false, browserServer: null };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--pretty') {
      options.pretty = true;
    } else if (arg === '--browser-server' && args[i + 1]) {
      options.browserServer = args[i + 1];
      i += 1;
    } else if (!options.url) {
      options.url = arg;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();
  if (!options.url || options.url === '--help' || options.url === '-h') {
    console.log('用法: node index.js answer <url> [--pretty] [--browser-server ws://localhost:18080]');
    return;
  }

  const browser = new BrowserAutomation(options.browserServer || process.env.JS_EYES_WS_URL || 'ws://localhost:18080');
  try {
    const result = await getAnswer(browser, options.url, options);
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
