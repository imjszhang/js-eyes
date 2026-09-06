#!/usr/bin/env node
'use strict';

const { BrowserAutomation } = require('@js-eyes/client-sdk');
const { readPage } = require('../lib/api');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');
const {
  applyVisualArgs,
  resolveVisualOptions,
  warnDeprecatedFlagsOnce,
  VISUAL_HELP_LINES,
} = require('../lib/cliVisualFlags');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: null,
    format: 'markdown',
    pretty: false,
    browserServer: null,
    recordingMode: null,
    recordingBaseDir: null,
    noCache: false,
    autoAllowDomain: false,
    persistAllowDomain: false,
    allowPrivateNetwork: false,
    keepOpen: false,
    closeAfter: undefined,
    tabId: null,
    allowExternalTab: false,
    waitUntil: undefined,
    waitForSelector: null,
    waitTimeoutMs: undefined,
    minContentChars: undefined,
    debugRecording: false,
    runId: null,
    visual: undefined,
    visualDetail: null,
    visualMs: null,
    visualFlashMs: null,
    visualLingerMs: null,
    visualPinnedHold: null,
    visualErrorPin: undefined,
    visualScrollSettleMs: null,
    visualStaggerFadein: undefined,
    visualHud: undefined,
    visualFlash: undefined,
    // visualMode 仅在用户传旧 --visual-mode 时由 applyVisualArgs 写入，让
    // parseVisualFlags 把它收进 deprecatedFlags 走 stderr 一次性告警（v0.6.0 BREAKING）。
    visualMode: null,
    visualTrace: null,
    visualRecord: undefined,
    visualListStride: null,
    visualPrefix: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const consumed = applyVisualArgs(args, i, options);
    if (consumed > 0) { i += consumed - 1; continue; }
    if (arg === '--pretty') {
      options.pretty = true;
    } else if (arg === '--format' && args[i + 1]) {
      options.format = args[i + 1];
      i += 1;
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
    } else if (arg === '--allow-new-domain' || arg === '--auto-allow-domain') {
      options.autoAllowDomain = true;
    } else if (arg === '--no-auto-allow-domain') {
      options.autoAllowDomain = false;
    } else if (arg === '--persist-allow-domain') {
      options.persistAllowDomain = true;
    } else if (arg === '--allow-private-network') {
      options.allowPrivateNetwork = true;
    } else if (arg === '--keep-open') {
      options.keepOpen = true;
    } else if (arg === '--close-after') {
      options.closeAfter = true;
    } else if (arg === '--tab-id' && args[i + 1]) {
      options.tabId = parseInt(args[i + 1], 10);
      i += 1;
    } else if (arg === '--allow-external-tab') {
      options.allowExternalTab = true;
    } else if (arg === '--wait-until' && args[i + 1]) {
      options.waitUntil = args[i + 1];
      i += 1;
    } else if (arg === '--wait-for-selector' && args[i + 1]) {
      options.waitForSelector = args[i + 1];
      i += 1;
    } else if (arg === '--wait-timeout-ms' && args[i + 1]) {
      options.waitTimeoutMs = Number(args[i + 1]);
      i += 1;
    } else if (arg === '--min-content-chars' && args[i + 1]) {
      options.minContentChars = Number(args[i + 1]);
      i += 1;
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
    console.log('用法: node index.js read <url> [--format markdown|text|html] [--pretty] [--browser-server ws://...]');
    console.log('      [--recording-mode standard] [--debug-recording] [--no-cache]');
    console.log('      [--auto-allow-domain|--no-auto-allow-domain] [--persist-allow-domain] [--allow-private-network]');
    console.log('      [--keep-open|--close-after] [--tab-id <id>] [--allow-external-tab]');
    console.log('      [--wait-until load|domcontentloaded|networkidle|selector|stable] [--wait-for-selector <css>]');
    console.log('      [--wait-timeout-ms 8000] [--min-content-chars 80]');
    console.log('视觉反馈选项:');
    VISUAL_HELP_LINES.forEach((l) => console.log(l));
    return;
  }

  const runtimeConfig = resolveRuntimeConfig({
    browserServer: options.browserServer || process.env.JS_EYES_WS_URL,
    recording: {
      ...(options.recordingMode ? { mode: options.recordingMode } : {}),
      ...(options.recordingBaseDir ? { baseDir: options.recordingBaseDir } : {}),
    },
  });

  const visual = resolveVisualOptions(options);
  warnDeprecatedFlagsOnce(visual.deprecatedFlags);

  const browser = new BrowserAutomation(runtimeConfig.serverUrl);
  try {
    const result = await readPage(browser, {
      url: options.url,
      tabId: options.tabId,
      format: options.format,
      waitUntil: options.waitUntil,
      waitForSelector: options.waitForSelector,
      waitTimeoutMs: options.waitTimeoutMs,
      minContentChars: options.minContentChars,
    }, {
      recording: runtimeConfig.recording,
      noCache: options.noCache,
      autoAllowDomain: options.autoAllowDomain,
      persistAllowDomain: options.persistAllowDomain,
      allowPrivateNetwork: options.allowPrivateNetwork,
      keepOpen: options.keepOpen,
      closeAfter: options.closeAfter,
      allowExternalTab: options.allowExternalTab === true,
      debugRecording: options.debugRecording,
      runId: options.runId,
      visual,
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
