'use strict';

const { Session } = require('../lib/session');
const { COMMANDS, parseArgv, printHelp } = require('../lib/commands');
const { PAGE_PROFILES, DEFAULT_PAGE } = require('../lib/config');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');
const { BrowserAutomation } = require('@js-eyes/client-sdk');
const { runTool } = require('../lib/runTool');

function pickPage(commandName, opts, extra) {
  if (opts.page) return opts.page;
  if (extra && extra.vertical === 'scholar') return 'scholar';
  const def = COMMANDS[commandName];
  if (def && def.defaultPage) return def.defaultPage;
  if (def && def.pages && def.pages.length === 1) return def.pages[0];
  return DEFAULT_PAGE;
}

function printJson(value, opts) {
  const indent = opts.pretty ? 2 : 0;
  process.stdout.write(JSON.stringify(value, null, indent) + '\n');
}

function buildSessionOpts(commandName, opts, extra = {}) {
  const def = COMMANDS[commandName] || {};
  return {
    page: pickPage(commandName, opts, extra),
    tab: opts.tab,
    verbose: opts.verbose,
    wsEndpoint: opts.wsEndpoint,
    targetUrl: extra.targetUrl || null,
    createIfMissing: extra.createIfMissing !== false,
    reuseAnyGoogleTab: extra.reuseAnyGoogleTab != null ? extra.reuseAnyGoogleTab : !!def.reuseAnyGoogleTab,
    navigateOnReuse: extra.navigateOnReuse === true,
    forceNewTab: extra.forceNewTab != null ? extra.forceNewTab : !!def.forceNewTab,
    closeCreatedTab: extra.closeCreatedTab != null ? extra.closeCreatedTab : (def.closeCreatedTab !== false),
    createUrl: extra.createUrl || null,
  };
}

async function runCallCommand(commandName, def, opts, positional) {
  const session = new Session({
    opts: buildSessionOpts(commandName, opts, {
      forceNewTab: false,
      closeCreatedTab: false,
      reuseAnyGoogleTab: true,
      createIfMissing: false,
    }),
  });
  try {
    await session.connect();
    await session.resolveTarget();
    await session.ensureBridge();
    const args = def.toArgs ? def.toArgs(opts, positional) : (positional || []);
    const response = await session.callApi(def.api, args);
    printJson(response, opts);
    return response && response.ok === false ? 1 : 0;
  } finally {
    await session.close();
  }
}

function validateRequiredArgs(def, positional) {
  const required = (def.argSpec || []).filter((s) => s.required);
  for (let i = 0; i < required.length; i++) {
    if (positional[i] == null || positional[i] === '') {
      const err = new Error(`参数缺失: <${required[i].name}>。${def.help || ''}`);
      err.code = 'E_BAD_ARG';
      throw err;
    }
  }
}

async function runToolCommand(commandName, def, opts, positional) {
  validateRequiredArgs(def, positional);
  const args = def.toArgs ? def.toArgs(opts, positional) : [{}];
  const payload = (args && args[0]) || {};
  const targetUrl = typeof def.targetUrl === 'function' ? def.targetUrl(opts, positional) : null;
  const runtimeConfig = resolveRuntimeConfig({
    browserServer: opts.wsEndpoint || process.env.JS_EYES_WS_URL,
    recording: {
      ...(opts.recordingMode ? { mode: opts.recordingMode } : {}),
      ...(opts.recordingBaseDir ? { baseDir: opts.recordingBaseDir } : {}),
    },
  });
  const browser = new BrowserAutomation(runtimeConfig.serverUrl, opts.verbose ? {} : {
    logger: { info: () => {}, warn: (...a) => console.error(...a), error: (...a) => console.error(...a) },
  });
  try {
    const response = await runTool(browser, {
      toolName: def.toolName,
      pageKey: pickPage(commandName, opts, payload),
      method: def.api,
      args: payload,
      targetUrl,
      options: {
        verbose: opts.verbose,
        tab: opts.tab,
        wsEndpoint: runtimeConfig.serverUrl,
        recording: runtimeConfig.recording,
        recordingMode: opts.recordingMode,
        debugRecording: opts.debugRecording,
        runId: opts.runId,
        forceNewTab: !!def.forceNewTab && opts.tab == null,
        closeCreatedTab: def.closeCreatedTab !== false && opts.tab == null,
        reuseAnyGoogleTab: !!def.reuseAnyGoogleTab,
        navigateOnReuse: false,
        createUrl: targetUrl || 'https://www.google.com/',
      },
    });
    printJson(response, opts);
    return response && response.ok === false ? 1 : 0;
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

async function runDomDump(opts) {
  const session = new Session({
    opts: Object.assign(buildSessionOpts('dom-dump', opts), {
      reuseAnyGoogleTab: true,
      forceNewTab: false,
      closeCreatedTab: false,
      createIfMissing: false,
    }),
  });
  try {
    await session.connect();
    await session.resolveTarget();
    await session.ensureBridge();
    const result = await session.callApi('dumpOutline', [{
      limit: opts.limit ? Number(opts.limit) : 80,
      anchors: !!opts.anchors,
    }]);
    printJson(result, opts);
    return result && result.ok === false ? 1 : 0;
  } finally {
    await session.close();
  }
}

async function runNavigateCommand(commandName, def, opts, positional) {
  validateRequiredArgs(def, positional);
  const navArgs = def.toNavArgs ? def.toNavArgs(opts, positional) : {};
  const session = new Session({
    opts: Object.assign(buildSessionOpts(commandName, opts, navArgs), {
      createIfMissing: true,
      navigateOnReuse: false,
      reuseAnyGoogleTab: true,
      forceNewTab: false,
      closeCreatedTab: false,
      createUrl: navArgs.vertical === 'scholar' ? 'https://scholar.google.com/' : 'https://www.google.com/',
    }),
  });
  try {
    await session.connect();
    await session.resolveTarget();
    await session.ensureBridge();
    const navResp = await session.callApi(def.api, [navArgs]);
    if (!navResp || !navResp.ok) {
      printJson({ ok: false, nav: navResp, postState: null }, opts);
      return 1;
    }
    const noop = navResp.data && navResp.data.noop === true;
    const fromUrl = navResp.data && navResp.data.from && navResp.data.from.url;
    const expectedUrl = navResp.data && navResp.data.to && navResp.data.to.url;
    const postState = noop
      ? { ready: true, attempts: 0, currentUrl: fromUrl || null, state: null, skipped: 'noop' }
      : await session.awaitBridgeAfterNav({
          timeoutMs: 20000,
          intervalMs: 500,
          initialDelayMs: 400,
          fromUrl: fromUrl || null,
          expectedUrl: expectedUrl || null,
        });
    printJson({ ok: !!postState.ready, nav: navResp, postState }, opts);
    return postState.ready ? 0 : 1;
  } finally {
    await session.close();
  }
}

async function runDoctor(opts) {
  const targetPages = opts.page ? [opts.page] : Object.keys(PAGE_PROFILES);
  const results = [];
  for (const pageName of targetPages) {
    const section = { page: pageName };
    const session = new Session({
      opts: Object.assign(buildSessionOpts('doctor', opts), {
        page: pageName,
        createIfMissing: false,
        forceNewTab: false,
        closeCreatedTab: false,
        reuseAnyGoogleTab: true,
      }),
    });
    try {
      await session.connect();
      section.connected = true;
      try {
        await session.resolveTarget();
        section.target = session.target;
      } catch (err) {
        section.targetError = { code: err.code || null, message: err.message };
        results.push(section);
        continue;
      }
      try {
        section.bridge = await session.ensureBridge();
      } catch (err) {
        section.bridgeError = { code: err.code || null, message: err.message, detail: err.detail || null };
        results.push(section);
        continue;
      }
      try { section.probe = await session.callApi('probe'); } catch (err) { section.probeError = { message: err.message }; }
      try { section.state = await session.callApi('state'); } catch (err) { section.stateError = { message: err.message }; }
    } catch (err) {
      section.connectError = { code: err.code || null, message: err.message };
    } finally {
      await session.close();
    }
    results.push(section);
  }
  const summary = results.map((r) => ({
    page: r.page,
    connected: !!r.connected,
    tab: r.target ? r.target.id : null,
    bridgeVersion: r.bridge ? r.bridge.version : null,
    stateReady: r.state && r.state.ok && r.state.data ? !!r.state.data.ready : null,
    blocker: r.probe && r.probe.ok && r.probe.data ? r.probe.data.blocker : null,
    error: r.connectError || r.targetError || r.bridgeError || null,
  }));
  const ok = results.every((r) => !r.connectError && !r.targetError && !r.bridgeError);
  printJson({ ok, summary, results }, opts);
  return ok ? 0 : 1;
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    return 2;
  }
  const { opts, positional } = parsed;
  const command = positional.shift();
  if (!command || opts.help) {
    printHelp();
    return 0;
  }
  const def = COMMANDS[command];
  if (!def) {
    process.stderr.write(`未知命令: ${command}\n`);
    printHelp();
    return 2;
  }
  try {
    if (command === 'doctor') return await runDoctor(opts);
    if (command === 'dom-dump') return await runDomDump(opts);
    if (def.kind === 'call') return await runCallCommand(command, def, opts, positional);
    if (def.kind === 'tool') return await runToolCommand(command, def, opts, positional);
    if (def.kind === 'navigate') return await runNavigateCommand(command, def, opts, positional);
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    return err.code === 'E_BAD_ARG' ? 2 : 1;
  }
  throw new Error(`command kind 不支持: ${def.kind}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code || 0)).catch((err) => {
    process.stderr.write(`ERROR: ${err.message}\n`);
    if (process.env.JS_GOOGLE_DEBUG) process.stderr.write((err.stack || '') + '\n');
    process.exit(1);
  });
}

module.exports = {
  main,
  runDoctor,
  runDomDump,
  runCallCommand,
  runToolCommand,
  runNavigateCommand,
  printHelp,
};
