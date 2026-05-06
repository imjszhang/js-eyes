'use strict';

const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const { COMMANDS, parseArgv, printHelp } = require('../lib/commands');
const { Session } = require('../lib/session');
const { BrowserAutomation } = require('../lib/js-eyes-client');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');
const { runTool } = require('../lib/runTool');
const { createSkillRunContext } = require('@js-eyes/skill-recording');
const { parseVisualFlags } = require('@js-eyes/visual-bridge-kit');

function emitJson(value, opts) {
  const s = opts.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  process.stdout.write(s + '\n');
}

function pickPage(cmdDef, opts) {
  if (opts.page) return opts.page;
  return cmdDef.defaultPage || (cmdDef.pages && cmdDef.pages[0]) || null;
}

async function runReadTool({ cmdDef, opts, positional, runtime }) {
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: opts.verbose ? console : { info: () => {}, warn: console.error, error: console.error },
  });
  const args = (cmdDef.toArgs || (() => [{}]))(opts, positional);
  const targetUrl = (cmdDef.targetUrl || (() => null))(opts, positional);
  const visualEnabled = opts.visual !== false && (opts.visual || opts.visualTrace || opts.visualRecord);
  const visualConfig = visualEnabled ? parseVisualFlags(opts).config : undefined;
  try {
    const result = await runTool(browser, {
      toolName: cmdDef.toolName,
      pageKey: pickPage(cmdDef, opts),
      method: cmdDef.api,
      cmdDef: cmdDef.cmdDef,
      args: args[0] || {},
      targetUrl,
      options: {
        wsEndpoint: runtime.serverUrl,
        recording: runtime.recording,
        recordingMode: opts.recordingMode || undefined,
        debugRecording: opts.debugRecording === true,
        noCache: opts.noCache === true,
        runId: opts.runId || undefined,
        verbose: !!opts.verbose,
        readMode: opts.readMode || undefined,
        navigateOnReuse: false,
        reuseAnyZhihuTab: true,
        timeoutMs: (opts.timeoutMs && Number(opts.timeoutMs) > 0) ? Number(opts.timeoutMs) : 90000,
        rateLimit: opts.rateLimit === true,
        visualConfig,
        visualTrace: opts.visualTrace || undefined,
        visualRecord: opts.visualRecord || undefined,
      },
    });
    if (!opts.quiet && result && result.run && result.run.paths && result.run.paths.historyFile) {
      process.stderr.write(`[zhihu] records: ${result.run.paths.historyFile}\n`);
    }
    if (!opts.quiet && result && result.visual && result.visual.enabled) {
      const visualPath = result.visual.recordDir || result.visual.traceFile || '(inline-only)';
      process.stderr.write(`[zhihu] visual: ${visualPath} (events=${result.visual.eventsCount || 0})\n`);
    }
    emitJson(result, opts);
    return result.ok ? 0 : 1;
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

async function runNavigate({ cmdDef, opts, positional, runtime }) {
  const navArgs = (cmdDef.toNavArgs || (() => ({})))(opts, positional);
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: opts.verbose ? console : { info: () => {}, warn: console.error, error: console.error },
  });
  const session = new Session({
    opts: {
      page: pickPage(cmdDef, opts),
      bot: browser,
      verbose: !!opts.verbose,
      wsEndpoint: runtime.serverUrl,
      createIfMissing: true,
      navigateOnReuse: false,
      reuseAnyZhihuTab: true,
      createUrl: 'https://www.zhihu.com/',
    },
  });
  const startedAt = Date.now();
  try {
    await session.connect();
    await session.resolveTarget();
    await session.ensureBridge();
    const navResp = await session.callApi(cmdDef.api, [navArgs]);
    if (!navResp || !navResp.ok) {
      emitJson({ ok: false, interactive: true, destructive: false, nav: navResp || null }, opts);
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
    emitJson({
      platform: 'zhihu',
      toolName: cmdDef.toolName,
      method: cmdDef.api,
      ok: !!postState.ready,
      interactive: true,
      destructive: false,
      run: { durationMs: Date.now() - startedAt },
      nav: navResp,
      postState,
    }, opts);
    return postState.ready ? 0 : 1;
  } finally {
    try { await session.close(); } catch (_) {}
    try { browser.disconnect(); } catch (_) {}
  }
}

async function runDoctor({ opts, runtime }) {
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: opts.verbose ? console : { info: () => {}, warn: console.error, error: console.error },
  });
  const summary = { ok: true, serverUrl: runtime.serverUrl, profiles: {} };
  try {
    await browser.connect();
    const tabs = await browser.getTabs();
    summary.tabsCount = (tabs && tabs.tabs && tabs.tabs.length) || 0;
    const { PAGE_PROFILES } = require('../lib/config');
    for (const key of Object.keys(PAGE_PROFILES)) {
      const profile = PAGE_PROFILES[key];
      const session = new Session({
        opts: {
          page: key,
          bot: browser,
          verbose: !!opts.verbose,
          wsEndpoint: runtime.serverUrl,
          createIfMissing: false,
          navigateOnReuse: false,
          reuseAnyZhihuTab: true,
        },
      });
      const entry = { profile: key, fragment: profile.targetUrlFragment };
      try {
        await session.resolveTarget();
        entry.target = session.target;
        entry.bridge = await session.ensureBridge();
        entry.state = await session.callApi('state');
      } catch (err) {
        entry.error = { code: err.code || 'unknown', message: err.message };
      } finally {
        await session.close();
      }
      summary.profiles[key] = entry;
    }
  } catch (err) {
    summary.ok = false;
    summary.error = { code: err.code || 'unknown', message: err.message };
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
  emitJson(summary, opts);
  return summary.ok ? 0 : 1;
}

async function runRecords({ opts, runtime }) {
  const ctx = createSkillRunContext({
    skillId: pkg.name,
    toolName: 'zhihu_records',
    scrapeType: 'zhihu_records',
    skillVersion: pkg.version,
    input: { records: true },
    recording: runtime.recording,
    noCache: true,
    normalizeInput: (value) => value,
    buildCacheKeyParts: ({ skillId, toolName, skillVersion }) => ({ skillId, toolName, version: skillVersion }),
  });
  const last = Number(opts.last) > 0 ? Number(opts.last) : 10;
  const toolFilter = opts.tool || null;
  const summary = {
    ok: true,
    skillId: pkg.name,
    historyDir: ctx.paths && ctx.paths.historyDir,
    cacheDir: ctx.paths && ctx.paths.cacheDir,
    debugDir: ctx.paths && ctx.paths.debugDir,
    last,
    toolFilter,
    entries: [],
  };
  try {
    if (!summary.historyDir || !fs.existsSync(summary.historyDir)) {
      emitJson(summary, opts);
      return 0;
    }
    const files = fs.readdirSync(summary.historyDir).filter((f) => f.endsWith('.jsonl')).sort().reverse();
    const collected = [];
    for (const fname of files) {
      const fpath = path.join(summary.historyDir, fname);
      const lines = fs.readFileSync(fpath, 'utf8').split(/\r?\n/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        let row = null;
        try { row = JSON.parse(lines[i]); } catch (_) { continue; }
        if (toolFilter && row.tool_name !== toolFilter) continue;
        collected.push({
          file: fpath,
          run_id: row.run_id,
          tool: row.tool_name,
          timestamp: row.timestamp,
          status: row.status,
          duration_ms: row.duration_ms,
          cache_hit: row.cache_hit,
          input: row.input_summary,
          error: row.error_summary || null,
          debugBundlePath: row.debug_bundle_path || null,
        });
        if (collected.length >= last) break;
      }
      if (collected.length >= last) break;
    }
    summary.entries = collected;
    emitJson(summary, opts);
    return 0;
  } catch (err) {
    summary.ok = false;
    summary.error = err.message || String(err);
    emitJson(summary, opts);
    return 1;
  }
}

async function dispatch(argv) {
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
    printHelp();
    return 0;
  }
  const cmd = argv[0];

  if (cmd === 'monitor') {
    const dispatcher = require('../lib/monitor/dispatcher');
    return dispatcher.dispatch(argv.slice(1));
  }

  if (process.env.JS_ZHIHU_DISABLE_BRIDGE === '1' && (cmd === 'answer' || cmd === 'article')) {
    const scriptModule = require(cmd === 'answer' ? '../scripts/zhihu-answer' : '../scripts/zhihu-article');
    const originalArgv = process.argv;
    process.argv = [process.argv[0], path.join(__dirname, '..', 'index.js'), ...argv.slice(1)];
    try {
      await scriptModule.main();
    } finally {
      process.argv = originalArgv;
    }
    return 0;
  }

  const cmdDef = COMMANDS[cmd];
  if (!cmdDef) {
    process.stderr.write(`未知命令: ${cmd}\n`);
    printHelp();
    return 2;
  }

  let parsed;
  try {
    parsed = parseArgv(argv.slice(1));
  } catch (err) {
    process.stderr.write(`参数错误: ${err.message}\n`);
    return 2;
  }
  const { opts, positional } = parsed;
  if (opts.help) {
    printHelp();
    return 0;
  }

  for (let i = 0; i < (cmdDef.argSpec || []).length; i++) {
    const spec = cmdDef.argSpec[i];
    if (spec.required && positional[i] == null) {
      process.stderr.write(`命令 ${cmd} 缺少参数 <${spec.name}>\n`);
      return 2;
    }
  }

  const runtime = resolveRuntimeConfig({
    serverUrl: opts.wsEndpoint || undefined,
    recording: {
      mode: opts.recordingMode || undefined,
      baseDir: opts.recordingBaseDir || undefined,
      noCache: opts.noCache === true ? true : undefined,
    },
  });

  try {
    switch (cmdDef.kind) {
      case 'tool': return await runReadTool({ cmdDef, opts, positional, runtime });
      case 'navigate': return await runNavigate({ cmdDef, opts, positional, runtime });
      case 'special':
        if (cmd === 'doctor') return await runDoctor({ opts, runtime });
        if (cmd === 'records') return await runRecords({ opts, runtime });
        process.stderr.write(`special 命令 ${cmd} 暂未实现\n`);
        return 2;
      default:
        process.stderr.write(`未支持的 command kind: ${cmdDef.kind}\n`);
        return 2;
    }
  } catch (err) {
    process.stderr.write(`命令失败：${err && err.message}\n`);
    if (opts.verbose && err && err.stack) process.stderr.write(err.stack + '\n');
    return 1;
  }
}

if (require.main === module) {
  dispatch(process.argv.slice(2))
    .then((code) => process.exit(typeof code === 'number' ? code : 0))
    .catch((err) => {
      process.stderr.write(`Fatal: ${err && err.message}\n`);
      process.exit(1);
    });
}

module.exports = { dispatch, run: dispatch };
