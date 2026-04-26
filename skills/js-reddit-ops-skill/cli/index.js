'use strict';

const { Session } = require('../lib/session');
const { COMMANDS, parseArgv, printHelp } = require('../lib/commands');
const { PAGE_PROFILES, DEFAULT_PAGE } = require('../lib/config');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');
const { BrowserAutomation } = require('../lib/js-eyes-client');
const { getPost } = require('../lib/api');
const { runTool } = require('../lib/runTool');

function pickPage(commandName, opts) {
  if (opts.page) return opts.page;
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
  return {
    page: pickPage(commandName, opts),
    tab: opts.tab,
    verbose: opts.verbose,
    wsEndpoint: opts.wsEndpoint,
    targetUrl: extra.targetUrl || null,
    createIfMissing: extra.createIfMissing !== false,
  };
}

async function runCallCommand(commandName, def, opts, positional) {
  const session = new Session({ opts: buildSessionOpts(commandName, opts) });
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
      pageKey: pickPage(commandName, opts),
      method: def.api,
      args: (args && args[0]) || {},
      targetUrl,
      options: {
        verbose: opts.verbose,
        tab: opts.tab,
        wsEndpoint: runtimeConfig.serverUrl,
        recording: runtimeConfig.recording,
        recordingMode: opts.recordingMode,
        debugRecording: opts.debugRecording,
        runId: opts.runId,
        navigateOnReuse: false,
        reuseAnyRedditTab: true,
        createUrl: targetUrl || 'https://www.reddit.com/',
      },
    });
    printJson(response, opts);
    return response && response.ok === false ? 1 : 0;
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

async function runPostCommand(opts, positional) {
  const url = positional[0];
  if (!url) {
    const err = new Error('post 用法: post <url> [--pretty] [--depth <n>] [--limit <n>] [--sort <name>] [--no-cache] [--debug-recording]');
    err.code = 'E_BAD_ARG';
    throw err;
  }
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
    const result = await getPost(browser, url, {
      browserServer: runtimeConfig.serverUrl,
      recording: runtimeConfig.recording,
      recordingMode: opts.recordingMode,
      recordingBaseDir: opts.recordingBaseDir,
      runId: opts.runId,
      noCache: opts.noCache,
      debugRecording: opts.debugRecording,
      depth: opts.depth ? Number(opts.depth) : undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
      sort: opts.sort || undefined,
      verbose: opts.verbose,
    });
    printJson(result, opts);
    return 0;
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

// ---- 内部踩点：dom-dump / xhr-log（不注入 bridge，直接 callRaw）----

const DOM_DUMP_FN_SRC = `function(args){
  args = args || {};
  const limit = Math.min(Math.max(parseInt(args.limit) || 80, 1), 200);
  const anchors = !!args.anchors;
  const out = [];
  const seen = new WeakSet();
  function dump(selector){
    let nodes;
    try { nodes = Array.from(document.querySelectorAll(selector)); } catch(_) { nodes = []; }
    for (let i = 0; i < nodes.length && i < limit; i++){
      const n = nodes[i];
      if (seen.has(n)) continue;
      seen.add(n);
      let rectTop = null;
      try { rectTop = Math.round(n.getBoundingClientRect().top); } catch(_) {}
      out.push({
        selector,
        tag: (n.tagName || '').toLowerCase(),
        id: n.id || '',
        cls: ((n.getAttribute && n.getAttribute('class')) || '').slice(0, 240),
        testid: (n.getAttribute && n.getAttribute('data-testid')) || '',
        href: (n.getAttribute && n.getAttribute('href')) || '',
        text: ((n.textContent || '').replace(/\\s+/g, ' ').trim()).slice(0, 200),
        rectTop,
      });
    }
  }
  dump('shreddit-app');
  dump('shreddit-feed');
  dump('shreddit-post');
  dump('shreddit-comment');
  dump('article[data-test-id]');
  dump('[data-testid]');
  dump('[id^=thing_]');
  dump('faceplate-tracker');
  if (anchors) dump('a[href]');
  return { ok: true, data: { url: location.href, returnedCount: out.length, items: out.slice(0, limit) } };
}`;

const XHR_LOG_FN_SRC = `function(args){
  args = args || {};
  const filterRaw = args.filter || 'reddit\\\\.com';
  let filterRegex;
  try { filterRegex = new RegExp(filterRaw); } catch(_) { filterRegex = /reddit\\.com/; }
  const limit = Math.min(Math.max(parseInt(args.limit) || 100, 1), 500);
  let entries = [];
  try { entries = performance.getEntriesByType('resource') || []; } catch(_) {}
  const matched = entries.filter((e) => e && e.name && filterRegex.test(e.name));
  const tail = matched.slice(-limit);
  const byPath = {};
  const items = tail.map((e) => {
    let pathname = e.name;
    try { pathname = new URL(e.name).pathname; } catch(_) {}
    byPath[pathname] = (byPath[pathname] || 0) + 1;
    return {
      url: e.name,
      pathname,
      initiatorType: e.initiatorType || '',
      durationMs: Math.round(e.duration || 0),
      transferSize: typeof e.transferSize === 'number' ? e.transferSize : null,
      startTime: Math.round(e.startTime || 0),
    };
  });
  return { ok: true, data: { url: location.href, totalMatched: matched.length, returnedCount: items.length, byPath, items } };
}`;

async function runDomDump(opts) {
  const session = new Session({
    opts: Object.assign(buildSessionOpts('dom-dump', opts), { reuseAnyRedditTab: true, navigateOnReuse: false, createIfMissing: false }),
  });
  try {
    await session.connect();
    await session.resolveTarget();
    const args = JSON.stringify({ limit: opts.limit ? Number(opts.limit) : 80, anchors: !!opts.anchors });
    const code = `Promise.resolve((${DOM_DUMP_FN_SRC})(${args})).then(r => JSON.stringify(r)).catch(e => JSON.stringify({ ok:false, error: String((e && e.message) || e) }))`;
    const result = await session.callRaw(code);
    printJson(result, opts);
    return result && result.ok === false ? 1 : 0;
  } finally {
    await session.close();
  }
}

async function runXhrLog(opts) {
  const session = new Session({
    opts: Object.assign(buildSessionOpts('xhr-log', opts), { reuseAnyRedditTab: true, navigateOnReuse: false, createIfMissing: false }),
  });
  try {
    await session.connect();
    await session.resolveTarget();
    const args = JSON.stringify({ filter: opts.filter || null, limit: opts.limit ? Number(opts.limit) : 100 });
    const code = `Promise.resolve((${XHR_LOG_FN_SRC})(${args})).then(r => JSON.stringify(r)).catch(e => JSON.stringify({ ok:false, error: String((e && e.message) || e) }))`;
    const result = await session.callRaw(code);
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
    opts: Object.assign(buildSessionOpts(commandName, opts), { createIfMissing: true, navigateOnReuse: false, reuseAnyRedditTab: true, createUrl: 'https://www.reddit.com/' }),
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
      opts: Object.assign(buildSessionOpts('doctor', opts), { page: pageName, createIfMissing: false }),
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
    loggedIn: r.probe && r.probe.ok && r.probe.data && r.probe.data.login ? !!r.probe.data.login.loggedIn : null,
    stateReady: r.state && r.state.ok && r.state.data ? !!r.state.data.ready : null,
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
    return command ? 0 : 0;
  }
  const def = COMMANDS[command];
  if (!def) {
    process.stderr.write(`未知命令: ${command}\n`);
    printHelp();
    return 2;
  }
  if (command === 'post') return runPostCommand(opts, positional);
  if (command === 'doctor') return runDoctor(opts);
  if (command === 'dom-dump') return runDomDump(opts);
  if (command === 'xhr-log') return runXhrLog(opts);
  if (def.kind === 'call') return runCallCommand(command, def, opts, positional);
  if (def.kind === 'tool') return runToolCommand(command, def, opts, positional);
  if (def.kind === 'navigate') return runNavigateCommand(command, def, opts, positional);
  throw new Error(`command kind 不支持: ${def.kind}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code || 0)).catch((err) => {
    process.stderr.write(`ERROR: ${err.message}\n`);
    if (process.env.JS_REDDIT_DEBUG) process.stderr.write((err.stack || '') + '\n');
    process.exit(1);
  });
}

module.exports = {
  main,
  runPostCommand,
  runDoctor,
  runDomDump,
  runXhrLog,
  runCallCommand,
  runToolCommand,
  runNavigateCommand,
  printHelp,
};
