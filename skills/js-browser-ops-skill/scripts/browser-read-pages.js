#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { BrowserAutomation } = require('@js-eyes/client-sdk');
const { readPages } = require('../lib/api');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');
const { runCliCommand } = require('../lib/cliRun');
const { toSkillError } = require('../lib/skillError');

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    file: null,
    stdin: false,
    urls: [],
    format: 'markdown',
    pretty: false,
    json: false,
    browserServer: null,
    concurrency: 3,
    perHostMinIntervalMs: 1000,
    perHostConcurrency: 1,
    timeoutMs: 30000,
    totalTimeoutMs: 180000,
    autoAllowDomain: false,
    persistAllowDomain: false,
    allowPrivateNetwork: false,
    noCache: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pretty') options.pretty = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--stdin' || arg === '-') options.stdin = true;
    else if ((arg === '--file' || arg === '--urls-file') && argv[i + 1]) {
      options.file = argv[i + 1];
      i += 1;
    } else if (arg === '--format' && argv[i + 1]) {
      options.format = argv[i + 1];
      i += 1;
    } else if (arg === '--browser-server' && argv[i + 1]) {
      options.browserServer = argv[i + 1];
      i += 1;
    } else if (arg === '--concurrency' && argv[i + 1]) {
      options.concurrency = Number(argv[i + 1]);
      i += 1;
    } else if ((arg === '--per-host-min-interval-ms' || arg === '--per-host-interval-ms') && argv[i + 1]) {
      options.perHostMinIntervalMs = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--per-host-concurrency' && argv[i + 1]) {
      options.perHostConcurrency = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--timeout-ms' && argv[i + 1]) {
      options.timeoutMs = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--total-timeout-ms' && argv[i + 1]) {
      options.totalTimeoutMs = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--allow-new-domain' || arg === '--auto-allow-domain') {
      options.autoAllowDomain = true;
    } else if (arg === '--persist-allow-domain') {
      options.persistAllowDomain = true;
    } else if (arg === '--allow-private-network') {
      options.allowPrivateNetwork = true;
    } else if (arg === '--no-cache') {
      options.noCache = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!arg.startsWith('-')) {
      if (!options.file && !arg.includes('://')) options.file = arg;
      else options.urls.push(arg);
    }
  }

  return options;
}

function parseUrlText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function loadUrls(options) {
  const urls = [...options.urls];
  if (options.file && options.file !== '-') {
    urls.push(...parseUrlText(fs.readFileSync(options.file, 'utf8')));
  }
  if (options.stdin || options.file === '-') {
    urls.push(...parseUrlText(fs.readFileSync(0, 'utf8')));
  }
  return [...new Set(urls.filter(Boolean))];
}

function printHelp() {
  console.log('用法: node index.js read-pages [--file urls.txt|-] [url...] [--json]');
  console.log('      [--concurrency 3] [--per-host-min-interval-ms 1000] [--per-host-concurrency 1]');
  console.log('      [--timeout-ms 30000] [--total-timeout-ms 180000] [--format markdown]');
  console.log('      [--auto-allow-domain] [--persist-allow-domain] [--allow-private-network] [--no-cache]');
}

async function main(cli = {}) {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  const urls = loadUrls(options);
  if (!urls.length) {
    if (!options.file && !options.stdin && options.urls.length === 0) {
      printHelp();
      return;
    }
    throw toSkillError('invalid_params', '必须提供 urls');
  }

  const runtimeConfig = resolveRuntimeConfig({
    browserServer: options.browserServer || process.env.JS_EYES_WS_URL,
  });

  const browser = new BrowserAutomation(runtimeConfig.serverUrl);
  try {
    const results = await readPages(browser, {
      urls,
      format: options.format,
      concurrency: options.concurrency,
      perHostMinIntervalMs: options.perHostMinIntervalMs,
      perHostConcurrency: options.perHostConcurrency,
      timeoutMs: options.timeoutMs,
      totalTimeoutMs: options.totalTimeoutMs,
      signal: cli.signal,
    }, {
      recording: runtimeConfig.recording,
      noCache: options.noCache,
      autoAllowDomain: options.autoAllowDomain,
      persistAllowDomain: options.persistAllowDomain,
      allowPrivateNetwork: options.allowPrivateNetwork,
      signal: cli.signal,
    });
    const payload = cli.json || options.json
      ? { ok: true, results }
      : results;
    console.log(JSON.stringify(payload, null, options.pretty ? 2 : 0));
  } finally {
    browser.disconnect();
  }
}

module.exports = { main, parseArgs, loadUrls, parseUrlText };

if (require.main === module) {
  runCliCommand(main);
}
