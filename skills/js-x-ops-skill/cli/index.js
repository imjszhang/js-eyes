'use strict';

/**
 * js-x-ops-skill CLI dispatcher（v3.0）
 *
 * 直接基于 lib/commands.js + lib/runTool.js + lib/session.js 调度，
 * 不再 spawnSync 二级派发。写操作（post --reply/--post/--quote/--thread/--media）
 * 仍透传给 scripts/x-post.js（v2 行为，v3.1 拆 compose-bridge 后再清理）。
 *
 * 命令分类（kind）：
 *   - special:   doctor / dom-dump / xhr-log（本文件直接处理）
 *   - call:      probe / state（直接 callApi，不进 history）
 *   - tool:      session-state / search / profile / post / home（进 history + debug bundle）
 *   - navigate:  navigate-search / navigate-profile / navigate-post / navigate-home
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pkg = require('../package.json');

const { Session } = require('../lib/session');
const { COMMANDS, parseArgv, printHelp, hasWriteFlags } = require('../lib/commands');
const { PAGE_PROFILES, DEFAULT_PAGE } = require('../lib/config');
const { resolveRequestTimeoutSec, resolveRuntimeConfig } = require('../lib/runtimeConfig');
const { BrowserAutomation } = require('../lib/js-eyes-client');
const { parseVisualFlags } = require('@js-eyes/visual-bridge-kit');
const { runTool } = require('../lib/runTool');
const { runMonitor } = require('../lib/monitor/dispatcher');
const { runApi } = require('../lib/official-api/dispatcher');
const apiLib = require('../lib/api');
const { attachPostMediaDownloads } = require('../lib/postMediaDownload');
const { warnDeprecatedFlagsOnce } = require('../lib/cliVisualFlags');

// ---------------------------------------------------------------------------
// 公共 helpers
// ---------------------------------------------------------------------------

function pickPage(commandName, opts) {
  if (opts.page) return opts.page;
  const def = COMMANDS[commandName];
  if (def && def.defaultPage) return def.defaultPage;
  if (def && def.pages && def.pages.length === 1) return def.pages[0];
  return DEFAULT_PAGE;
}

function buildEnvelope(value, opts = {}) {
  const ok = !(value && value.ok === false);
  return {
    ok,
    result: value,
    error: ok ? null : {
      code: (value && (value.code || value.errorCode || value.error)) || 'command_failed',
      message: String((value && (value.message || value.error)) || 'command failed'),
    },
    meta: {
      version: pkg.version,
      command: opts.command || null,
      duration_ms: opts.startedAt ? Date.now() - opts.startedAt : null,
    },
  };
}

function printJson(value, opts) {
  const payload = buildEnvelope(value, opts);
  const indent = opts && opts.pretty ? 2 : 0;
  const text = JSON.stringify(payload, null, indent) + '\n';
  if (opts && opts.output) {
    try {
      const abs = path.resolve(opts.output);
      const dir = path.dirname(abs);
      if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(abs, text, 'utf8');
    } catch (e) {
      process.stderr.write(`ERROR: 无法写入 --output: ${e.message}\n`);
      throw e;
    }
  }
  process.stdout.write(text);
}

function createBrowserAutomation(runtimeConfig, opts) {
  const requestTimeoutSec = resolveRequestTimeoutSec({
    requestTimeout: opts.requestTimeout,
  });
  const browserOpts = {
    defaultTimeout: requestTimeoutSec,
  };
  if (!opts.verbose) {
    browserOpts.logger = {
      info: () => {},
      warn: (...a) => console.error(...a),
      error: (...a) => console.error(...a),
    };
  }
  return {
    browser: new BrowserAutomation(runtimeConfig.serverUrl, browserOpts),
    requestTimeoutSec,
  };
}

function buildSessionOpts(commandName, opts, extra = {}) {
  return Object.assign({
    page: pickPage(commandName, opts),
    tab: opts.tab,
    verbose: opts.verbose,
    wsEndpoint: opts.wsEndpoint,
    targetUrl: extra.targetUrl || null,
    createIfMissing: extra.createIfMissing !== false,
    navigateOnReuse: extra.navigateOnReuse === true,
    reuseAnyXTab: extra.reuseAnyXTab !== false,
    createUrl: extra.createUrl || 'https://x.com/',
  }, extra);
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

// ---------------------------------------------------------------------------
// kind=call：probe / state
// ---------------------------------------------------------------------------

async function runCallCommand(commandName, def, opts, positional) {
  const session = new Session({
    opts: buildSessionOpts(commandName, opts, { createIfMissing: false }),
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

// ---------------------------------------------------------------------------
// kind=tool：READ 档（进 history + debug bundle）
// ---------------------------------------------------------------------------

async function runToolCommand(commandName, def, opts, positional) {
  validateRequiredArgs(def, positional);
  const args = def.toArgs ? def.toArgs(opts, positional) : [{}];
  const targetUrl = typeof def.targetUrl === 'function' ? def.targetUrl(opts, positional) : null;

  const runtimeConfig = resolveRuntimeConfig({
    browserServer: opts.wsEndpoint || process.env.JS_EYES_WS_URL,
    requestTimeout: opts.requestTimeout,
    recording: {
      ...(opts.recordingMode ? { mode: opts.recordingMode } : {}),
      ...(opts.recordingBaseDir ? { baseDir: opts.recordingBaseDir } : {}),
    },
  });
  const { browser, requestTimeoutSec } = createBrowserAutomation(runtimeConfig, opts);
  try {
    const vp = parseVisualFlags(opts);
    warnDeprecatedFlagsOnce(vp.deprecatedFlags);
    const response = await runTool(browser, {
      toolName: def.toolName,
      pageKey: pickPage(commandName, opts),
      method: def.api,
      cmdDef: def.cmdDef || null,
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
        reuseAnyXTab: true,
        createUrl: targetUrl || 'https://x.com/',
        readMode: opts.readMode || 'auto',
        timeoutMs: requestTimeoutSec * 1000,
        visualConfig: vp.config,
        visualTrace: vp.tracePath || undefined,
        visualRecord: vp.recordDir || undefined,
        noFrames: opts.noFrames === true,
        hiDpi: opts.hiDpi === true,
        maxFrames: opts.maxFrames != null ? Number(opts.maxFrames) : undefined,
      },
    });
    if (commandName === 'post' && opts.downloadMedia && response && response.ok && response.result) {
      response.result = await attachPostMediaDownloads(response.result, {
        downloadMedia: true,
        outDir: opts.outDir,
        logger: opts.verbose ? console : { info: () => {} },
      });
    }
    printJson(response, opts);
    return response && response.ok === false ? 1 : 0;
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// kind=navigate：INTERACTIVE 档（仅 location.assign，不模拟点击）
// ---------------------------------------------------------------------------

async function runNavigateCommand(commandName, def, opts, positional) {
  validateRequiredArgs(def, positional);
  const navArgs = def.toNavArgs ? def.toNavArgs(opts, positional) : {};
  const session = new Session({
    opts: buildSessionOpts(commandName, opts, {
      createIfMissing: true,
      navigateOnReuse: false,
      reuseAnyXTab: true,
      createUrl: 'https://x.com/',
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

// ---------------------------------------------------------------------------
// post 多 positional 批量路径：直接走 lib/api.js::getPost（它已原生支持
// tweetInputs 数组，内部 _postWithBridgeOrFallback 会对每个 id 分别调
// bridge.getPost 并聚合为统一 response）。保持和单 URL 的 runToolCommand
// 路径互补：单 URL 仍走 runTool（history / debug bundle 与之前完全一致）。
// ---------------------------------------------------------------------------

async function runGetPostBatchCommand(opts, positional) {
  const runtimeConfig = resolveRuntimeConfig({
    browserServer: opts.wsEndpoint || process.env.JS_EYES_WS_URL,
    requestTimeout: opts.requestTimeout,
    recording: {
      ...(opts.recordingMode ? { mode: opts.recordingMode } : {}),
      ...(opts.recordingBaseDir ? { baseDir: opts.recordingBaseDir } : {}),
    },
  });
  const { browser, requestTimeoutSec } = createBrowserAutomation(runtimeConfig, opts);
  try {
    const response = await apiLib.getPost(browser, positional.slice(), {
      withThread: !!opts.withThread,
      withReplies: opts.withReplies ? Number(opts.withReplies) : 0,
      ...(opts.budgetMs != null && Number(opts.budgetMs) > 0 ? { budgetMs: Number(opts.budgetMs) } : {}),
      downloadMedia: !!opts.downloadMedia,
      outDir: opts.outDir || undefined,
      recording: runtimeConfig.recording,
      recordingMode: opts.recordingMode,
      debugRecording: opts.debugRecording,
      runId: opts.runId,
      wsEndpoint: runtimeConfig.serverUrl,
      verbose: opts.verbose,
      tab: opts.tab,
      bridgeTimeoutMs: requestTimeoutSec * 1000,
    });
    printJson(response, opts);
    return response && response.ok === false ? 1 : 0;
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// 写操作透传（post --reply / --post / --quote / --thread / --media / --dry-run / --confirm）
// ---------------------------------------------------------------------------

function runWriteCommand(rawArgv) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'x-post.js');
    const child = spawn(process.execPath, [scriptPath, ...rawArgv.slice(1)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => resolve(code || 0));
    child.on('error', (err) => {
      process.stderr.write(`spawn x-post.js failed: ${err.message}\n`);
      resolve(1);
    });
  });
}

// ---------------------------------------------------------------------------
// kind=special：doctor / dom-dump / xhr-log
// ---------------------------------------------------------------------------

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
  dump('article[data-testid="tweet"]');
  dump('[data-testid="primaryColumn"]');
  dump('[data-testid="UserCell"]');
  dump('[data-testid="cellInnerDiv"]');
  dump('[data-testid="tweetText"]');
  dump('[data-testid="User-Name"]');
  dump('[data-testid="loginButton"]');
  dump('[data-testid="AppTabBar_Profile_Link"]');
  dump('[data-testid="SideNav_NewTweet_Button"]');
  dump('[data-testid]');
  if (anchors) dump('a[href]');
  return { ok: true, data: { url: location.href, returnedCount: out.length, items: out.slice(0, limit) } };
}`;

const XHR_LOG_FN_SRC = `function(args){
  args = args || {};
  const filterRaw = args.filter || 'i\\\\/api\\\\/graphql\\\\/';
  let filterRegex;
  try { filterRegex = new RegExp(filterRaw); } catch(_) { filterRegex = /i\\/api\\/graphql\\//; }
  const limit = Math.min(Math.max(parseInt(args.limit) || 100, 1), 500);
  let entries = [];
  try { entries = performance.getEntriesByType('resource') || []; } catch(_) {}
  const matched = entries.filter((e) => e && e.name && filterRegex.test(e.name));
  const tail = matched.slice(-limit);
  const byOp = {};
  const items = tail.map((e) => {
    let pathname = e.name;
    let op = '';
    try {
      const u = new URL(e.name);
      pathname = u.pathname;
      const m = u.pathname.match(/i\\/api\\/graphql\\/([A-Za-z0-9_-]+)\\/([A-Za-z0-9_-]+)/);
      if (m) op = m[2];
    } catch(_) {}
    if (op) byOp[op] = (byOp[op] || 0) + 1;
    return {
      url: e.name,
      pathname,
      op,
      initiatorType: e.initiatorType || '',
      durationMs: Math.round(e.duration || 0),
      transferSize: typeof e.transferSize === 'number' ? e.transferSize : null,
      startTime: Math.round(e.startTime || 0),
    };
  });
  return { ok: true, data: { url: location.href, totalMatched: matched.length, returnedCount: items.length, byOp, items } };
}`;

async function runDomDump(opts) {
  const session = new Session({
    opts: buildSessionOpts('dom-dump', opts, { createIfMissing: false, reuseAnyXTab: true }),
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
    opts: buildSessionOpts('xhr-log', opts, { createIfMissing: false, reuseAnyXTab: true }),
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

async function runDoctor(opts) {
  const targetPages = opts.page ? [opts.page] : Object.keys(PAGE_PROFILES);
  const results = [];
  for (const pageName of targetPages) {
    const section = { page: pageName };
    const session = new Session({
      opts: buildSessionOpts('doctor', opts, { page: pageName, createIfMissing: false, reuseAnyXTab: true }),
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

// ---------------------------------------------------------------------------
// main dispatcher
// ---------------------------------------------------------------------------

async function main(argv) {
  if (argv.includes('--version') || argv.includes('-V')) {
    process.stdout.write(pkg.version + '\n');
    return 0;
  }

  // 写操作分支：post 命令带 --reply/--post/--quote/--thread/--media/--dry-run/--confirm
  // 直接透传给 scripts/x-post.js（v2 行为，不解析）。
  const command0 = argv[0];
  if (command0 === 'post' && hasWriteFlags(argv)) {
    return await runWriteCommand(argv);
  }

  // monitor 命令有独立 sub-arg parser（--channels / --dry-notify / --interval 等），
  // 早于通用 parseArgv 分派，避免那边对未知选项抛错。
  if (command0 === 'monitor') {
    return await runMonitor(argv.slice(1));
  }

  if (command0 === 'api') {
    return await runApi(argv.slice(1));
  }

  if (command0 === 'trends') {
    return await runApi(['trends', ...argv.slice(1)]);
  }

  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    return 2;
  }
  const { opts, positional } = parsed;
  const command = positional.shift();
  opts.command = command || null;
  opts.startedAt = Date.now();
  if (!command || opts.help) {
    printHelp();
    return 0;
  }
  const def = COMMANDS[command];
  if (!def) {
    process.stderr.write(`未知命令: ${command}\n\n`);
    printHelp();
    return 2;
  }

  if (command === 'doctor') return runDoctor(opts);
  if (command === 'dom-dump') return runDomDump(opts);
  if (command === 'xhr-log') return runXhrLog(opts);
  // READ post 统一走 lib/api.js::getPost；它会按输入类型分派到
  // getPost 或 getArticle，并同时支持单条、批量和混合输入。
  if (command === 'post' && positional.length >= 1) {
    return runGetPostBatchCommand(opts, positional);
  }
  if (def.kind === 'call') return runCallCommand(command, def, opts, positional);
  if (def.kind === 'tool') return runToolCommand(command, def, opts, positional);
  if (def.kind === 'navigate') return runNavigateCommand(command, def, opts, positional);
  throw new Error(`command kind 不支持: ${def.kind}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code || 0)).catch((err) => {
    process.stderr.write(`ERROR: ${err.message}\n`);
    if (process.env.JS_X_DEBUG) process.stderr.write((err.stack || '') + '\n');
    process.exit(1);
  });
}

module.exports = {
  main,
  printUsage: printHelp,
  runCallCommand,
  runToolCommand,
  runNavigateCommand,
  runWriteCommand,
  runGetPostBatchCommand,
  runDoctor,
  runDomDump,
  runXhrLog,
};
