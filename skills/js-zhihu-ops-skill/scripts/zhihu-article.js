#!/usr/bin/env node
'use strict';

const { BrowserAutomation } = require('../lib/js-eyes-client');
const { getArticle } = require('../lib/api');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: null,
    pretty: false,
    browserServer: null,
    recordingMode: null,
    recordingBaseDir: null,
    noCache: false,
    debugRecording: false,
    runId: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--pretty') {
      options.pretty = true;
    } else if (arg === '--browser-server' && args[i + 1]) {
      options.browserServer = args[i + 1];
      i += 1;
    } else if (arg === '--recording-mode' && args[i + 1]) {
      options.recordingMode = args[i + 1];
      i += 1;
    } else if (arg === '--recording-base-dir' && args[i + 1]) {
      options.recordingBaseDir = args[i + 1];
      i += 1;
    } else if (arg === '--run-id' && args[i + 1]) {
      options.runId = args[i + 1];
      i += 1;
    } else if (arg === '--no-cache') {
      options.noCache = true;
    } else if (arg === '--debug-recording') {
      options.debugRecording = true;
    } else if (!options.url) {
      options.url = arg;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();
  if (!options.url || options.url === '--help' || options.url === '-h') {
    console.log('用法: node index.js article <url> [--pretty] [--browser-server ws://localhost:18080] [--recording-mode standard] [--debug-recording] [--no-cache]');
    return;
  }

  const runtimeConfig = resolveRuntimeConfig({
    browserServer: options.browserServer || process.env.JS_EYES_WS_URL,
    recording: {
      ...(options.recordingMode ? { mode: options.recordingMode } : {}),
      ...(options.recordingBaseDir ? { baseDir: options.recordingBaseDir } : {}),
    },
  });

  const browser = new BrowserAutomation(runtimeConfig.serverUrl);
  try {
    const result = await getArticle(browser, options.url, {
      ...options,
      recording: runtimeConfig.recording,
    });
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
