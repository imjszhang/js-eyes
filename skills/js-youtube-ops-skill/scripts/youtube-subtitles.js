#!/usr/bin/env node
'use strict';

const { getSubtitles } = require('../lib/api');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: null,
    pretty: false,
    noCookies: false,
    cookiesFromBrowser: 'firefox',
    subLangs: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--pretty') {
      options.pretty = true;
    } else if (arg === '--no-cookies') {
      options.noCookies = true;
    } else if (arg === '--cookies-from-browser' && args[i + 1]) {
      options.cookiesFromBrowser = args[i + 1];
      i += 1;
    } else if (arg === '--sub-langs' && args[i + 1]) {
      options.subLangs = args[i + 1];
      i += 1;
    } else if (!options.url) {
      options.url = arg;
    }
  }

  return options;
}

function printUsage() {
  console.log('用法: node index.js subtitles <url> [--pretty] [--no-cookies] [--cookies-from-browser <browser>]');
}

async function main() {
  const options = parseArgs();
  if (!options.url || options.url === '--help' || options.url === '-h') {
    printUsage();
    return;
  }

  const result = await getSubtitles(options.url, {
    noCookies: options.noCookies,
    cookiesFromBrowser: options.cookiesFromBrowser,
    subLangs: options.subLangs,
  });

  console.log(JSON.stringify(result, null, options.pretty ? 2 : 0));
}

module.exports = { main, parseArgs };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
