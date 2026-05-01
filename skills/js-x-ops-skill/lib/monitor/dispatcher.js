'use strict';

/**
 * monitor dispatcher - 把 `node index.js monitor <sub> [args]` 分派到具体 handler
 *
 * 用一套独立的轻量 arg parser，不复用 lib/commands.js::parseArgv，避免污染后者。
 *
 * Phase 1 实现：init / add / remove / list / status / test / check
 * Phase 4 追加：daemon / stop
 */

const { BrowserAutomation } = require('../js-eyes-client');
const { resolveRuntimeConfig } = require('../runtimeConfig');
const {
  loadConfig,
  saveConfig,
  exists: configExists,
  defaultConfig,
  ensureBaseDirs,
  effectiveAccountSettings,
} = require('./config');
const { loadState } = require('./state');
const { runCheck } = require('./runCheck');
const { resolvePaths } = require('./paths');
const { fetchAccount } = require('./fetchAccount');
const { startDaemon, stopDaemon, readExistingPid } = require('./daemon');

// ---------------------------------------------------------------------------
// arg parser
// ---------------------------------------------------------------------------

function parseMonitorArgs(argv) {
  const opts = {
    json: false,
    pretty: false,
    verbose: false,
    help: false,
    wsEndpoint: null,
    recordingMode: null,
    channels: null,       // --channels feishu,discord -> 字符串数组
    dryNotify: false,
    dryState: false,
    interval: null,
    force: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = (k) => { opts[k] = argv[++i]; };
    const eatEq = (k, prefix) => { opts[k] = a.slice(prefix.length); };
    if (a === '--json') opts.json = true;
    else if (a === '--pretty') opts.pretty = true;
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--dry-notify') opts.dryNotify = true;
    else if (a === '--dry-state') opts.dryState = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--server' || a === '--ws-endpoint' || a === '--browser-server') eat('wsEndpoint');
    else if (a.startsWith('--server=') || a.startsWith('--ws-endpoint=') || a.startsWith('--browser-server=')) {
      opts.wsEndpoint = a.slice(a.indexOf('=') + 1);
    }
    else if (a === '--recording-mode') eat('recordingMode');
    else if (a.startsWith('--recording-mode=')) eatEq('recordingMode', '--recording-mode=');
    else if (a === '--channels') opts.channels = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--channels=')) opts.channels = a.slice('--channels='.length).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--interval') opts.interval = Number(argv[++i]);
    else if (a.startsWith('--interval=')) opts.interval = Number(a.slice('--interval='.length));
    else if (a.startsWith('-')) {
      const err = new Error(`monitor: 未知选项 ${a}`);
      err.code = 'E_BAD_ARG';
      throw err;
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

function printJson(value, opts) {
  const indent = opts && opts.pretty ? 2 : 0;
  process.stdout.write(JSON.stringify(value, null, indent) + '\n');
}

function printMonitorHelp() {
  const lines = [
    'js-x-ops-skill monitor - X.com 账号监控',
    '',
    'Usage: node index.js monitor <subcommand> [args] [options]',
    '',
    'Subcommands:',
    '  init                          初始化配置目录与 config.json',
    '  add <username> [--channels ...]   添加监控账号',
    '  remove <username>             移除监控账号',
    '  list                          列出所有监控账号',
    '  status                        汇总 per-account state',
    '  test <username>               对单账号跑一次 fetch（不写 state、不发通知）',
    '  check [username]              真实 check（会写 state + 发通知）；传 username 只跑单账号',
    '  daemon [--interval N]         本地守护模式：循环执行 check；SIGINT/SIGTERM 退出',
    '  stop                          向运行中的 daemon 发 SIGTERM',
    '',
    'Options:',
    '  --channels a,b                逗号分隔的 channel name（add 时用）',
    '  --dry-notify                  check 时跳过真实通知（仅打印）',
    '  --dry-state                   check 时不写 state（调试用）',
    '  --interval <sec>              daemon 循环间隔秒（最小 30）',
    '  --force                       daemon 启动时忽略残留 pid',
    '  --json / --pretty             输出 JSON / 缩进',
    '  --server <ws-url>             js-eyes WS endpoint',
    '  --recording-mode <mode>       off|history|standard|debug',
    '',
    'Notes:',
    '  * 配置路径：~/.js-eyes/skill-data/js-x-ops-skill/monitor/config.json',
    '  * 可通过环境变量 JS_X_MONITOR_HOME 整体重定向（测试用）',
    '  * daemon 是前台进程；生产环境建议配合 nohup / systemd / launchd 使用',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// sub-handlers
// ---------------------------------------------------------------------------

async function handleInit(opts) {
  const paths = ensureBaseDirs();
  if (configExists() && !opts.force) {
    const msg = {
      ok: true,
      initialized: true,
      alreadyExisted: true,
      configFile: paths.configFile,
      hint: '已存在，未覆盖；如需重置请使用 --force',
    };
    printJson(msg, opts);
    return 0;
  }
  const cfg = defaultConfig();
  saveConfig(cfg);
  printJson({ ok: true, initialized: true, alreadyExisted: false, configFile: paths.configFile, paths }, opts);
  return 0;
}

async function handleAdd(username, opts) {
  const cleanUsername = String(username || '').replace(/^@/, '').trim();
  if (!cleanUsername) {
    printJson({ ok: false, error: 'missing_username' }, opts);
    return 2;
  }
  const config = loadConfig();
  const existing = (config.accounts || []).find((a) => String(a.username).toLowerCase() === cleanUsername.toLowerCase());
  if (existing) {
    if (Array.isArray(opts.channels)) existing.channels = opts.channels;
    existing.enabled = true;
    saveConfig(config);
    printJson({ ok: true, added: false, updated: true, account: existing, accountsCount: config.accounts.length }, opts);
    return 0;
  }
  const record = {
    username: cleanUsername,
    enabled: true,
    addedAt: new Date().toISOString(),
  };
  if (Array.isArray(opts.channels)) record.channels = opts.channels;
  config.accounts.push(record);
  saveConfig(config);
  printJson({ ok: true, added: true, updated: false, account: record, accountsCount: config.accounts.length }, opts);
  return 0;
}

async function handleRemove(username, opts) {
  const cleanUsername = String(username || '').replace(/^@/, '').trim();
  if (!cleanUsername) {
    printJson({ ok: false, error: 'missing_username' }, opts);
    return 2;
  }
  const config = loadConfig();
  const before = config.accounts.length;
  config.accounts = (config.accounts || []).filter((a) => String(a.username).toLowerCase() !== cleanUsername.toLowerCase());
  const removed = before - config.accounts.length;
  saveConfig(config);
  printJson({ ok: true, removed, accountsCount: config.accounts.length }, opts);
  return 0;
}

async function handleList(opts) {
  const config = loadConfig();
  const accounts = (config.accounts || []).map((a) => effectiveAccountSettings(a, config));
  printJson({
    ok: true,
    configFile: resolvePaths().configFile,
    accountsCount: accounts.length,
    accounts,
    channels: (config.channels || []).map((c) => ({ name: c.name, type: c.type })),
    scheduling: config.scheduling || null,
    deduplication: config.deduplication || null,
  }, opts);
  return 0;
}

async function handleStatus(opts) {
  let config = null;
  try { config = loadConfig(); } catch (err) {
    printJson({ ok: false, error: err.code || 'E_LOAD_CONFIG', message: err.message }, opts);
    return 1;
  }
  const { pidFile } = resolvePaths();
  let daemon = null;
  try {
    const pidRaw = require('fs').readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(pidRaw, 10);
    let alive = false;
    if (pid > 0) {
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    }
    daemon = { pidFile, pid, alive };
  } catch (err) {
    daemon = { pidFile, pid: null, alive: false };
  }

  const accountsSummary = (config.accounts || []).map((a) => {
    const st = (() => { try { return loadState(a.username); } catch { return null; } })();
    return {
      username: a.username,
      enabled: a.enabled !== false,
      lastCheck: st?.lastCheck || null,
      lastError: st?.lastError || null,
      knownTweetCount: Array.isArray(st?.tweets) ? st.tweets.length : 0,
    };
  });

  printJson({
    ok: true,
    configFile: resolvePaths().configFile,
    accountsCount: accountsSummary.length,
    accounts: accountsSummary,
    daemon,
  }, opts);
  return 0;
}

async function handleTest(username, opts) {
  const cleanUsername = String(username || '').replace(/^@/, '').trim();
  if (!cleanUsername) {
    printJson({ ok: false, error: 'missing_username' }, opts);
    return 2;
  }
  const config = loadConfig();
  const found = (config.accounts || []).find((a) => String(a.username).toLowerCase() === cleanUsername.toLowerCase());
  const settings = effectiveAccountSettings(found || { username: cleanUsername, enabled: true }, config);
  const runtimeConfig = resolveRuntimeConfig({
    browserServer: opts.wsEndpoint || process.env.JS_EYES_WS_URL,
    recording: opts.recordingMode ? { mode: opts.recordingMode } : {},
  });
  const browser = new BrowserAutomation(runtimeConfig.serverUrl, {
    logger: { info: () => {}, warn: (...a) => console.error(...a), error: (...a) => console.error(...a) },
  });
  try {
    const result = await fetchAccount(browser, settings, { recording: runtimeConfig.recording });
    printJson({
      ok: result.ok,
      username: settings.username,
      sampleSize: result.tweets.length,
      rawCount: result.rawCount,
      meta: result.meta,
      profile: result.profile ? { screenName: result.profile.screenName, name: result.profile.name } : null,
      tweets: result.tweets.slice(0, 3).map((t) => ({
        tweetId: t.tweetId,
        publishTime: t.publishTime,
        content: String(t.content || '').slice(0, 120),
      })),
      error: result.error || null,
    }, opts);
    return result.ok ? 0 : 1;
  } finally {
    try { browser.disconnect(); } catch {}
  }
}

async function handleCheck(username, opts) {
  let config;
  try { config = loadConfig(); } catch (err) {
    printJson({ ok: false, error: err.code || 'E_LOAD_CONFIG', message: err.message }, opts);
    return 1;
  }
  const runtimeConfig = resolveRuntimeConfig({
    browserServer: opts.wsEndpoint || process.env.JS_EYES_WS_URL,
    recording: opts.recordingMode ? { mode: opts.recordingMode } : {},
  });
  const browser = new BrowserAutomation(runtimeConfig.serverUrl, {
    logger: { info: () => {}, warn: (...a) => console.error(...a), error: (...a) => console.error(...a) },
  });
  try {
    const result = await runCheck({
      config,
      browser,
      options: {
        singleUsername: username || null,
        dryNotify: !!opts.dryNotify,
        dryState: !!opts.dryState,
        recording: runtimeConfig.recording,
        logger: {
          info: (...a) => opts.verbose && console.error('[info]', ...a),
          warn: (...a) => console.error('[warn]', ...a),
          error: (...a) => console.error('[error]', ...a),
        },
      },
    });
    printJson(result, opts);
    return result.ok ? 0 : 1;
  } finally {
    try { browser.disconnect(); } catch {}
  }
}

async function handleDaemon(opts) {
  const existing = readExistingPid();
  if (existing && !opts.force) {
    printJson({ ok: false, error: 'daemon_already_running', pid: existing, hint: '如确定为残留 pid，使用 --force 或手动删除 pid 文件' }, opts);
    return 1;
  }
  if (existing && opts.force) {
    process.stderr.write(`[monitor] --force: 忽略残留 pid=${existing}\n`);
    require('fs').unlinkSync(resolvePaths().pidFile);
  }
  try {
    await startDaemon({
      intervalSec: opts.interval || undefined,
      dryNotify: !!opts.dryNotify,
      wsEndpoint: opts.wsEndpoint,
      recordingMode: opts.recordingMode,
    });
    return 0;
  } catch (err) {
    if (err.code === 'E_DAEMON_ALREADY_RUNNING') {
      printJson({ ok: false, error: err.code, pid: err.pid, message: err.message }, opts);
      return 1;
    }
    process.stderr.write(`ERROR: ${err.message}\n`);
    return 1;
  }
}

async function handleStop(opts) {
  const result = stopDaemon();
  printJson(result, opts);
  return result.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function runMonitor(argv) {
  let parsed;
  try { parsed = parseMonitorArgs(argv); } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    printMonitorHelp();
    return 2;
  }
  const { opts, positional } = parsed;
  const sub = positional.shift();
  if (!sub || opts.help) { printMonitorHelp(); return 0; }

  try {
    switch (sub) {
      case 'init':    return await handleInit(opts);
      case 'add':     return await handleAdd(positional[0], opts);
      case 'remove':  return await handleRemove(positional[0], opts);
      case 'list':    return await handleList(opts);
      case 'status':  return await handleStatus(opts);
      case 'test':    return await handleTest(positional[0], opts);
      case 'check':   return await handleCheck(positional[0] || null, opts);
      case 'daemon':  return await handleDaemon(opts);
      case 'stop':    return await handleStop(opts);
      default:
        process.stderr.write(`未知 monitor subcommand: ${sub}\n`);
        printMonitorHelp();
        return 2;
    }
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    if (process.env.JS_X_DEBUG) process.stderr.write((err.stack || '') + '\n');
    return 1;
  }
}

module.exports = {
  runMonitor,
  parseMonitorArgs,
  printMonitorHelp,
  handleInit,
  handleAdd,
  handleRemove,
  handleList,
  handleStatus,
  handleTest,
  handleCheck,
  handleDaemon,
  handleStop,
};
