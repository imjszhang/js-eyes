#!/usr/bin/env node
'use strict';

/**
 * cli/index.js - js-xiaohongshu-ops-skill 命令分派器（v2.1+）
 *
 * 与 [skills/js-x-ops-skill/cli/index.js] 同形态，按 lib/commands.js 声明式映射：
 *   - kind=tool     → lib/runTool.js
 *   - kind=navigate → bridge.navigateXxx (仅 location.assign)
 *   - kind=call     → session.callApi(api)
 *   - kind=special  → 在本文件单独处理（doctor / dom-dump / monitor）
 *
 * 未来 monitor 子命令分派到 lib/monitor/dispatcher.js（v3.0 落地）。
 */

const path = require('path');
const { COMMANDS, parseArgv, printHelp } = require('../lib/commands');
const { Session } = require('../lib/session');
const { BrowserAutomation } = require('../lib/js-eyes-client');
const { resolveRuntimeConfig } = require('../lib/runtimeConfig');
const { runTool } = require('../lib/runTool');

function pickPage(cmdDef, opts) {
  if (opts.page) return opts.page;
  return cmdDef.defaultPage || (cmdDef.pages && cmdDef.pages[0]) || null;
}

function emitJson(value, opts) {
  const s = opts.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  process.stdout.write(s + '\n');
}

async function runReadTool({ cmd, cmdDef, opts, positional, runtime }) {
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: opts.verbose ? console : { info: () => {}, warn: console.error, error: console.error },
  });
  const args = (cmdDef.toArgs || (() => [{}]))(opts, positional);
  const targetUrl = (cmdDef.targetUrl || (() => null))(opts, positional);
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
        runId: opts.runId || undefined,
        verbose: !!opts.verbose,
        readMode: opts.readMode || undefined,
        navigateOnReuse: false,
        reuseAnyXhsTab: true,
        timeoutMs: 90000,
        rateLimit: opts.rateLimit === true,
        visualConfig: (opts.visual || opts.visualHud || opts.visualFlash) ? {
          enabled: opts.visual !== false,
          hud: opts.visualHud === true,
          flash: opts.visualFlash === true,
        } : undefined,
        visualTrace: opts.visualTrace || undefined,
        visualRecord: opts.visualRecord !== undefined ? opts.visualRecord : undefined,
      },
    });
    if (!opts.quiet && result && result.run && result.run.paths && result.run.paths.historyFile) {
      try {
        const sizeHint = result.result
          ? (Array.isArray(result.result.notes) ? `notes=${result.result.notes.length}`
            : Array.isArray(result.result.comments) ? `comments=${result.result.comments.length}`
            : Array.isArray(result.result.items) ? `items=${result.result.items.length}`
            : (result.result.note ? 'note=1' : ''))
          : '';
        process.stderr.write(`[xhs] records: ${result.run.paths.historyFile}${sizeHint ? ' (' + sizeHint + ')' : ''}\n`);
      } catch (_) {}
    }
    emitJson(result, opts);
    return result.ok ? 0 : 1;
  } finally {
    try { browser.disconnect(); } catch {}
  }
}

async function runNavigate({ cmd, cmdDef, opts, positional, runtime }) {
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
      reuseAnyXhsTab: true,
      createUrl: 'https://www.xiaohongshu.com/',
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
    let postState = noop
      ? { ready: true, attempts: 0, currentUrl: fromUrl || null, state: null, skipped: 'noop' }
      : await session.awaitBridgeAfterNav({
          timeoutMs: 20000,
          intervalMs: 500,
          initialDelayMs: 400,
          fromUrl: fromUrl || null,
          expectedUrl: expectedUrl || null,
        });
    // SPA 兜底：当 bridge 内 location.assign 被 SPA 路由拦截（url_unchanged）时，
    // 走扩展的 chrome.tabs.update 做硬跳转，绕开页内拦截。
    if (!postState.ready && postState.error === 'url_unchanged' && expectedUrl && session.target && session.target.rawId != null) {
      try {
        // 二段跳：先 about:blank 切断 SPA history / hash 拦截，再回到目标 URL。
        await browser.openUrl('about:blank', session.target.rawId);
        await new Promise((r) => setTimeout(r, 500));
        await browser.openUrl(expectedUrl, session.target.rawId);
        const fallbackState = await session.awaitBridgeAfterNav({
          timeoutMs: 25000,
          intervalMs: 500,
          initialDelayMs: 800,
          fromUrl: 'about:blank',
          expectedUrl: expectedUrl || null,
        });
        postState = Object.assign({}, fallbackState, { spaFallback: 'about-blank+tabs.update' });
      } catch (err) {
        postState = Object.assign({}, postState, { spaFallback: 'tabs.update_failed', spaFallbackError: String((err && err.message) || err) });
      }
    }
    emitJson({
      platform: 'xiaohongshu',
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
    try { await session.close(); } catch {}
    try { browser.disconnect(); } catch {}
  }
}

async function runCall({ cmd, cmdDef, opts, positional, runtime }) {
  const args = (cmdDef.toArgs || (() => []))(opts, positional);
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: opts.verbose ? console : { info: () => {}, warn: console.error, error: console.error },
  });
  const session = new Session({
    opts: {
      page: pickPage(cmdDef, opts),
      bot: browser,
      verbose: !!opts.verbose,
      wsEndpoint: runtime.serverUrl,
      createIfMissing: false,
      navigateOnReuse: false,
      reuseAnyXhsTab: true,
    },
  });
  try {
    await session.connect();
    await session.resolveTarget();
    await session.ensureBridge();
    const resp = await session.callApi(cmdDef.api, args);
    emitJson(resp, opts);
    return resp && resp.ok ? 0 : 1;
  } finally {
    try { await session.close(); } catch {}
    try { browser.disconnect(); } catch {}
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
          reuseAnyXhsTab: true,
        },
      });
      const entry = { profile: key, fragment: profile.targetUrlFragment };
      try {
        await session.resolveTarget();
        entry.target = session.target;
        const meta = await session.ensureBridge();
        entry.bridge = meta;
        const stateResp = await session.callApi('state');
        entry.state = stateResp;
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
    try { browser.disconnect(); } catch {}
  }
  emitJson(summary, opts);
  return summary.ok ? 0 : 1;
}

async function runLogin({ opts, runtime }) {
  const LOGIN_URL = 'https://www.xiaohongshu.com/login';
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 5 * 60 * 1000;
  const intervalMs = 3000;
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: opts.verbose ? console : { info: () => {}, warn: console.error, error: console.error },
  });
  const result = { ok: false, loginUrl: LOGIN_URL };
  let session = null;
  try {
    await browser.connect();
    session = new Session({
      opts: {
        page: 'home',
        bot: browser,
        targetUrl: LOGIN_URL,
        verbose: !!opts.verbose,
        wsEndpoint: runtime.serverUrl,
        createIfMissing: true,
        navigateOnReuse: true,
        reuseAnyXhsTab: true,
        createUrl: LOGIN_URL,
      },
    });
    await session.connect();
    await session.resolveTarget();
    await session.ensureBridge();

    // 已登录则直接成功
    let initial = null;
    try { initial = await session.callApi('sessionState'); } catch (_) { initial = null; }
    const initialFlags = initial && initial.ok && initial.data && initial.data.cookieFlags;
    if (initialFlags && initialFlags.hasWebSession) {
      result.ok = true;
      result.alreadyLoggedIn = true;
      result.cookieFlags = initialFlags;
      emitJson(result, opts);
      return 0;
    }

    // 主动导航到登录页（若未在登录页）
    if (session.target && session.target.rawId != null) {
      try { await browser.openUrl(LOGIN_URL, session.target.rawId); } catch (_) {}
    }

    process.stderr.write(`[xhs] 已打开登录页，请在浏览器内完成登录（最长等待 ${Math.round(timeoutMs / 1000)}s）...\n`);
    const startedAt = Date.now();
    let lastFlags = initialFlags || null;
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((r) => setTimeout(r, intervalMs));
      let resp = null;
      try { resp = await session.callApi('sessionState'); } catch (_) { resp = null; }
      const flags = resp && resp.ok && resp.data && resp.data.cookieFlags;
      if (flags) {
        lastFlags = flags;
        if (flags.hasWebSession) {
          result.ok = true;
          result.cookieFlags = flags;
          result.elapsedMs = Date.now() - startedAt;
          emitJson(result, opts);
          return 0;
        }
      }
    }
    result.ok = false;
    result.error = 'login_timeout';
    result.cookieFlags = lastFlags;
    result.elapsedMs = Date.now() - startedAt;
    emitJson(result, opts);
    return 1;
  } catch (err) {
    result.ok = false;
    result.error = err && err.code || 'login_failed';
    result.message = err && err.message || String(err);
    emitJson(result, opts);
    return 1;
  } finally {
    try { if (session) await session.close(); } catch (_) {}
    try { browser.disconnect(); } catch (_) {}
  }
}

async function runRecords({ opts, runtime }) {
  const fs = require('fs');
  const path = require('path');
  const pkg = require('../package.json');
  const { getSkillRecordPaths } = require('@js-eyes/runtime-paths');
  const skillId = pkg.name;
  const last = Number(opts.last) > 0 ? Number(opts.last) : 10;
  const toolFilter = opts.tool || null;

  const paths = getSkillRecordPaths(skillId, {
    recordingBaseDir: runtime.recording && runtime.recording.baseDir,
  });
  const summary = {
    ok: true,
    skillId,
    historyDir: paths.historyDir,
    cacheDir: paths.cacheDir,
    debugDir: paths.debugDir,
    last,
    toolFilter,
    entries: [],
  };
  try {
    if (!fs.existsSync(paths.historyDir)) {
      summary.entries = [];
      emitJson(summary, opts);
      return 0;
    }
    const files = fs.readdirSync(paths.historyDir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .reverse();
    const collected = [];
    for (const fname of files) {
      const fpath = path.join(paths.historyDir, fname);
      let content = '';
      try { content = fs.readFileSync(fpath, 'utf8'); } catch (_) { continue; }
      const lines = content.split(/\r?\n/).filter(Boolean);
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
    summary.error = err && err.message || String(err);
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

  // monitor 子命令暂留给 v3.0 PR-7 实现；当前提示未实现。
  if (cmd === 'monitor') {
    let dispatcher;
    try { dispatcher = require('../lib/monitor/dispatcher'); } catch (_) { dispatcher = null; }
    if (dispatcher && typeof dispatcher.dispatch === 'function') {
      return dispatcher.dispatch(argv.slice(1));
    }
    process.stderr.write('monitor 子命令尚未在当前版本启用（v3.0 PR-7 落地）\n');
    return 2;
  }

  // 老版本 fallback：JS_XHS_DISABLE_BRIDGE=1 时 note 命令走 scripts/xhs-note.js
  if (cmd === 'note' && process.env.JS_XHS_DISABLE_BRIDGE === '1') {
    const scriptModule = require('../scripts/xhs-note');
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

  // argSpec required 检查
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
      case 'tool':     return await runReadTool({ cmd, cmdDef, opts, positional, runtime });
      case 'navigate': return await runNavigate({ cmd, cmdDef, opts, positional, runtime });
      case 'call':     return await runCall({ cmd, cmdDef, opts, positional, runtime });
      case 'special':
        if (cmd === 'doctor') return await runDoctor({ opts, runtime });
        if (cmd === 'login')  return await runLogin({ opts, runtime });
        if (cmd === 'records') return await runRecords({ opts, runtime });
        process.stderr.write(`special 命令 ${cmd} 暂未实现\n`);
        return 2;
      default:
        process.stderr.write(`未支持的 command kind: ${cmdDef.kind}\n`);
        return 2;
    }
  } catch (err) {
    process.stderr.write(`命令失败：${err && err.message}\n`);
    if (opts.verbose && err && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
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

module.exports = { dispatch };
