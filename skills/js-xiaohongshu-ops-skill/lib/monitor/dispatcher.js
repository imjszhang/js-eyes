'use strict';

/**
 * monitor dispatcher（xhs 版） - CLI 子命令分派器
 *
 * 暴露的子命令：
 *   monitor init                                                       初始化默认 config（不存在时）
 *   monitor list                                                       列出 accounts + searches
 *   monitor add user <username|userId> [--channels c1,c2]
 *   monitor add search <keyword> [--channel-type 全部|图文|视频|用户]
 *   monitor remove user <username|userId>
 *   monitor remove search <keyword>
 *   monitor status                                                     daemon pid + 各 target lastCheck
 *   monitor test [user <name>|search <keyword>]                        单 target dry run
 *   monitor check [--dry-notify]                                       同步跑一次完整 check
 *   monitor daemon [--interval N --dry-notify --once]                  循环 check
 *   monitor stop                                                       停掉 daemon
 *
 * 注：CLI 入口（index.js）会触发 webhook，**不进 AI tool 列表**。
 */

const fs = require('fs');
const { BrowserAutomation } = require('../js-eyes-client');
const { resolveRuntimeConfig } = require('../runtimeConfig');
const cfgMod = require('./config');
const stateMod = require('./state');
const { runCheck, runCheckCore } = require('./runCheck');
const { startDaemon, stopDaemon, readExistingPid } = require('./daemon');
const { resolvePaths } = require('./paths');

function emit(value, opts) {
  const s = (opts && opts.pretty) ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  process.stdout.write(s + '\n');
}

function parseFlags(argv) {
  const out = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pretty') out.flags.pretty = true;
    else if (a === '--dry-notify') out.flags.dryNotify = true;
    else if (a === '--once') out.flags.once = true;
    else if (a === '--interval') out.flags.interval = argv[++i];
    else if (a.startsWith('--interval=')) out.flags.interval = a.slice('--interval='.length);
    else if (a === '--channels') out.flags.channels = argv[++i];
    else if (a.startsWith('--channels=')) out.flags.channels = a.slice('--channels='.length);
    else if (a === '--channel-type') out.flags.channelType = argv[++i];
    else if (a.startsWith('--channel-type=')) out.flags.channelType = a.slice('--channel-type='.length);
    else if (a === '--limit') out.flags.limit = argv[++i];
    else if (a.startsWith('--limit=')) out.flags.limit = a.slice('--limit='.length);
    else if (a === '--server') out.flags.wsEndpoint = argv[++i];
    else if (a.startsWith('--server=')) out.flags.wsEndpoint = a.slice('--server='.length);
    else out.positional.push(a);
  }
  return out;
}

async function cmdInit({ flags }) {
  if (cfgMod.exists()) {
    const file = require('./paths').resolvePaths().configFile;
    emit({ ok: true, alreadyExists: true, configFile: file }, flags);
    return 0;
  }
  cfgMod.ensureBaseDirs();
  const file = cfgMod.saveConfig(cfgMod.defaultConfig());
  emit({ ok: true, created: true, configFile: file }, flags);
  return 0;
}

function _loadOrInit() {
  if (!cfgMod.exists()) cfgMod.saveConfig(cfgMod.defaultConfig());
  return cfgMod.loadConfig();
}

async function cmdList({ flags }) {
  const config = _loadOrInit();
  emit({
    ok: true,
    accounts: config.accounts || [],
    searches: config.searches || [],
    channels: config.channels || [],
    scheduling: config.scheduling || {},
    deduplication: config.deduplication || {},
  }, flags);
  return 0;
}

async function cmdAdd({ flags, positional }) {
  const sub = positional[0];
  const value = positional[1];
  if (!sub || !value) {
    process.stderr.write('用法: monitor add user <username|userId> | monitor add search <keyword>\n');
    return 2;
  }
  const config = _loadOrInit();
  const channels = flags.channels ? flags.channels.split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (sub === 'user') {
    if (config.accounts.find((a) => (a.username || a.userId) === value)) {
      emit({ ok: false, error: 'duplicate', value }, flags);
      return 1;
    }
    config.accounts.push({ username: value, userId: value, enabled: true, addedAt: new Date().toISOString(), channels });
  } else if (sub === 'search') {
    if (config.searches.find((s) => s.keyword === value && (s.channelType || '全部') === (flags.channelType || '全部'))) {
      emit({ ok: false, error: 'duplicate', value }, flags);
      return 1;
    }
    config.searches.push({
      keyword: value,
      channelType: flags.channelType || '全部',
      limit: flags.limit ? Number(flags.limit) : undefined,
      enabled: true,
      addedAt: new Date().toISOString(),
      channels,
    });
  } else {
    process.stderr.write(`未知子命令: ${sub}（支持 user / search）\n`);
    return 2;
  }
  cfgMod.saveConfig(config);
  emit({ ok: true, added: { type: sub, value } }, flags);
  return 0;
}

async function cmdRemove({ flags, positional }) {
  const sub = positional[0];
  const value = positional[1];
  if (!sub || !value) {
    process.stderr.write('用法: monitor remove user <username|userId> | monitor remove search <keyword>\n');
    return 2;
  }
  const config = _loadOrInit();
  let removed = null;
  if (sub === 'user') {
    const before = config.accounts.length;
    config.accounts = config.accounts.filter((a) => (a.username || a.userId) !== value);
    removed = before - config.accounts.length;
  } else if (sub === 'search') {
    const before = config.searches.length;
    config.searches = config.searches.filter((s) => s.keyword !== value);
    removed = before - config.searches.length;
  } else {
    process.stderr.write(`未知子命令: ${sub}\n`);
    return 2;
  }
  cfgMod.saveConfig(config);
  emit({ ok: removed > 0, removed }, flags);
  return removed > 0 ? 0 : 1;
}

async function cmdStatus({ flags }) {
  const pid = readExistingPid();
  const paths = resolvePaths();
  const states = stateMod.allStates();
  emit({
    ok: true,
    daemon: { running: !!pid, pid: pid || null, pidFile: paths.pidFile },
    paths,
    targets: states.map((s) => ({
      target: s.target,
      lastCheck: s.lastCheck,
      lastError: s.lastError,
      notesCount: (s.notes || []).length,
    })),
  }, flags);
  return 0;
}

async function cmdCheck({ flags }) {
  const config = _loadOrInit();
  const runtime = resolveRuntimeConfig({ browserServer: flags.wsEndpoint || undefined });
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: { info: () => {}, warn: console.error, error: console.error },
  });
  try {
    const result = await runCheck({
      config,
      browser,
      options: {
        dryNotify: !!flags.dryNotify,
        recording: runtime.recording,
        logger: { info: () => {}, warn: (...a) => console.error(...a), error: (...a) => console.error(...a) },
      },
    });
    emit(result, flags);
    return result.ok ? 0 : 1;
  } finally {
    try { browser.disconnect(); } catch {}
  }
}

async function cmdTest({ flags, positional }) {
  const config = _loadOrInit();
  const sub = positional[0];
  const value = positional[1];
  let opts = {};
  if (sub && value) {
    opts.singleType = sub === 'user' ? 'account' : sub === 'search' ? 'search' : null;
    opts.singleTargetId = value;
  }
  const runtime = resolveRuntimeConfig({ browserServer: flags.wsEndpoint || undefined });
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: { info: () => {}, warn: console.error, error: console.error },
  });
  try {
    const result = await runCheckCore({
      config,
      browser,
      options: Object.assign({}, opts, {
        recording: runtime.recording,
        writeState: false,
      }),
    });
    emit(result, flags);
    return result.ok ? 0 : 1;
  } finally {
    try { browser.disconnect(); } catch {}
  }
}

async function cmdDaemon({ flags }) {
  await startDaemon({
    intervalSec: flags.interval ? Number(flags.interval) : undefined,
    dryNotify: !!flags.dryNotify,
    once: !!flags.once,
    wsEndpoint: flags.wsEndpoint || undefined,
  });
  return 0;
}

async function cmdStop({ flags }) {
  const result = stopDaemon();
  emit(result, flags);
  return result.ok ? 0 : 1;
}

const SUBCMDS = {
  init: cmdInit,
  list: cmdList,
  add: cmdAdd,
  remove: cmdRemove,
  status: cmdStatus,
  check: cmdCheck,
  test: cmdTest,
  daemon: cmdDaemon,
  stop: cmdStop,
};

function printHelp() {
  process.stdout.write([
    'monitor 子命令：',
    '  init                                  初始化默认 config',
    '  list                                  列出 accounts + searches',
    '  add user <username|userId> [--channels c1,c2]',
    '  add search <keyword> [--channel-type 全部|图文|视频|用户] [--limit N]',
    '  remove user <username|userId>',
    '  remove search <keyword>',
    '  status                                daemon pid + 各 target 状态',
    '  check [--dry-notify]                  同步跑一次完整 check（会触发 webhook）',
    '  test [user <name>|search <kw>]        单 target dry run，不写 state，不发通知',
    '  daemon [--interval N --dry-notify]    循环 check',
    '  stop                                  停掉 daemon',
    '',
  ].join('\n'));
}

async function dispatch(argv) {
  const sub = argv[0];
  if (!sub || sub === '-h' || sub === '--help') { printHelp(); return 0; }
  const handler = SUBCMDS[sub];
  if (!handler) { printHelp(); return 2; }
  const parsed = parseFlags(argv.slice(1));
  try {
    return await handler({ flags: parsed.flags, positional: parsed.positional });
  } catch (err) {
    process.stderr.write(`monitor ${sub} 失败: ${err.message}\n`);
    return 1;
  }
}

module.exports = { dispatch, parseFlags };
