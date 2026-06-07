'use strict';

/**
 * monitor dispatcher - 把 `node index.js monitor <sub> [args]` 分派到具体 handler
 *
 * 用一套独立的轻量 arg parser，不复用 lib/commands.js::parseArgv，避免污染后者。
 *
 * Phase 1 实现：init / add / remove / list / status / test / check
 * Phase 4 追加：daemon / stop
 */

const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');
const { BrowserAutomation } = require('../js-eyes-client');
const { resolveRuntimeConfig } = require('../runtimeConfig');
const {
  loadConfig,
  saveConfig,
  exists: configExists,
  defaultConfig,
  ensureBaseDirs,
  effectiveAccountSettings,
  validateConfig,
} = require('./config');
const { loadState } = require('./state');
const { runCheck, runCheckCore } = require('./runCheck');
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
    output: null,
    config: null,
    stateHome: null,
    noNotify: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = (k) => { opts[k] = argv[++i]; };
    const eatEq = (k, prefix) => { opts[k] = a.slice(prefix.length); };
    if (a === '--json') opts.json = true;
    else if (a === '--pretty') opts.pretty = true;
    else if (a === '--output') eat('output');
    else if (a.startsWith('--output=')) eatEq('output', '--output=');
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--dry-notify') opts.dryNotify = true;
    else if (a === '--dry-state') opts.dryState = true;
    else if (a === '--no-notify') opts.noNotify = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--config') eat('config');
    else if (a.startsWith('--config=')) eatEq('config', '--config=');
    else if (a === '--state-home') eat('stateHome');
    else if (a.startsWith('--state-home=')) eatEq('stateHome', '--state-home=');
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
      command: opts.command || 'monitor',
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
    '  check --config <file>         使用指定 config JSON 执行批量 check',
    '  daemon [--interval N]         本地守护模式：循环执行 check；SIGINT/SIGTERM 退出',
    '  stop                          向运行中的 daemon 发 SIGTERM',
    '',
    'Options:',
    '  --channels a,b                逗号分隔的 channel name（add 时用）',
    '  --dry-notify                  check 时跳过真实通知（仅打印）',
    '  --dry-state                   check 时不写 state（调试用）',
    '  --no-notify                   check --config 时仅抓取/去重/写 state，不触发通知',
    '  --config <file>               check 时从指定 JSON 文件读取完整 monitor config',
    '  --state-home <dir>            check 时覆盖 monitor state 根目录',
    '  --interval <sec>              daemon 循环间隔秒（最小 30）',
    '  --force                       daemon 启动时忽略残留 pid',
    '  --json / --pretty             输出 JSON / 缩进',
    '  --output <file>               同时将 JSON 写入文件（与 stdout 一致；目录不存在则创建）',
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
  if (opts.config) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.resolve(opts.config), 'utf8'));
      const validated = validateConfig(raw);
      if (!validated.ok) {
        printJson({
          ok: false,
          error: 'E_MONITOR_CONFIG_INVALID',
          message: `monitor 配置校验失败:\n  - ${validated.errors.join('\n  - ')}`,
          errors: validated.errors,
        }, opts);
        return 1;
      }
      config = validated.config;
    } catch (err) {
      printJson({
        ok: false,
        error: err.code || 'E_LOAD_CONFIG',
        message: err.message,
        configFile: path.resolve(opts.config),
      }, opts);
      return 1;
    }
  } else try { config = loadConfig(); } catch (err) {
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
    const commonOptions = {
      singleUsername: username || null,
      dryState: !!opts.dryState,
      writeState: opts.dryState ? false : undefined,
      stateHome: opts.stateHome || undefined,
      recording: runtimeConfig.recording,
      logger: {
        info: (...a) => opts.verbose && console.error('[info]', ...a),
        warn: (...a) => console.error('[warn]', ...a),
        error: (...a) => console.error('[error]', ...a),
      },
    };
    const result = opts.noNotify || opts.config
      ? await runCheckCore({
        config,
        browser,
        options: commonOptions,
      })
      : await runCheck({
        config,
        browser,
        options: {
          ...commonOptions,
          dryNotify: !!opts.dryNotify,
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
  opts.command = sub ? `monitor ${sub}` : 'monitor';
  opts.startedAt = Date.now();
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
