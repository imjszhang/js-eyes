#!/usr/bin/env node
'use strict';

const { getSubtitles } = require('../lib/api');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: null,
    pretty: false,
    noCookies: false,
    cookiesFromBrowser: 'firefox',
    subLangs: null,
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
    } else if (arg === '--no-cookies') {
      options.noCookies = true;
    } else if (arg === '--cookies-from-browser' && args[i + 1]) {
      options.cookiesFromBrowser = args[i + 1];
      i += 1;
    } else if (arg === '--sub-langs' && args[i + 1]) {
      options.subLangs = args[i + 1];
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

function printUsage() {
  console.log('用法: node index.js subtitles <url> [--pretty] [--no-cookies] [--cookies-from-browser <browser>] [--recording-mode standard] [--debug-recording] [--no-cache]');
}

async function main() {
  const options = parseArgs();
  if (!options.url || options.url === '--help' || options.url === '-h') {
    printUsage();
    return;
  }

  const runtimeConfig = resolveRuntimeConfig({
    recording: {
      ...(options.recordingMode ? { mode: options.recordingMode } : {}),
      ...(options.recordingBaseDir ? { baseDir: options.recordingBaseDir } : {}),
    },
  });

  const result = await getSubtitles(options.url, {
    noCookies: options.noCookies,
    cookiesFromBrowser: options.cookiesFromBrowser,
    subLangs: options.subLangs,
    recording: runtimeConfig.recording,
    recordingMode: options.recordingMode,
    debugRecording: options.debugRecording,
    noCache: options.noCache,
    runId: options.runId,
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
