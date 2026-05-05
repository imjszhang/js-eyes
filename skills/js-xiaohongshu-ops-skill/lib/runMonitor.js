'use strict';

/**
 * lib/runMonitor.js - monitor 子系统的"受控 AI 工具" dispatcher
 *
 * 暴露 5 个 AI 工具（不会触发 webhook），均为只读或低风险的 config / state 操作：
 *   - list_targets        列出 accounts + searches + channels
 *   - get_status          返回 daemon pid + 各 target lastCheck/notesCount
 *   - add_target          添加一个 user/search target
 *   - remove_target       删除一个 user/search target
 *   - test_target         单 target dry run（runCheckCore，不写 state、不发通知）
 *
 * **不**暴露 init/check/daemon/stop（这些会触发 webhook，仅 CLI 用）。
 */

const cfgMod = require('./monitor/config');
const stateMod = require('./monitor/state');
const { runCheckCore } = require('./monitor/runCheck');
const { readExistingPid } = require('./monitor/daemon');
const { resolvePaths } = require('./monitor/paths');
const { resolveRuntimeConfig } = require('./runtimeConfig');
const { BrowserAutomation } = require('./js-eyes-client');

function _loadOrInit() {
  if (!cfgMod.exists()) cfgMod.saveConfig(cfgMod.defaultConfig());
  return cfgMod.loadConfig();
}

async function listTargets() {
  const config = _loadOrInit();
  return {
    ok: true,
    accounts: config.accounts || [],
    searches: config.searches || [],
    channels: (config.channels || []).map((c) => ({ name: c.name, type: c.type })),
    scheduling: config.scheduling || {},
    deduplication: config.deduplication || {},
  };
}

async function getStatus() {
  const pid = readExistingPid();
  const paths = resolvePaths();
  const states = stateMod.allStates();
  return {
    ok: true,
    daemon: { running: !!pid, pid: pid || null, pidFile: paths.pidFile },
    paths,
    targets: states.map((s) => ({
      target: s.target,
      lastCheck: s.lastCheck,
      lastError: s.lastError,
      notesCount: (s.notes || []).length,
      lastNote: (s.notes || [])[0] || null,
    })),
  };
}

async function addTarget(params) {
  if (!params || !params.type) {
    return { ok: false, error: 'type required ("user" | "search")' };
  }
  const config = _loadOrInit();
  if (params.type === 'user') {
    const value = params.username || params.userId;
    if (!value) return { ok: false, error: 'username or userId required' };
    if (config.accounts.find((a) => (a.username || a.userId) === value)) {
      return { ok: false, error: 'duplicate', value };
    }
    config.accounts.push({
      username: params.username || value,
      userId: params.userId || value,
      enabled: true,
      addedAt: new Date().toISOString(),
      channels: Array.isArray(params.channels) && params.channels.length ? params.channels : null,
    });
  } else if (params.type === 'search') {
    if (!params.keyword) return { ok: false, error: 'keyword required' };
    if (config.searches.find((s) => s.keyword === params.keyword
        && (s.channelType || '全部') === (params.channelType || '全部'))) {
      return { ok: false, error: 'duplicate', value: params.keyword };
    }
    config.searches.push({
      keyword: params.keyword,
      channelType: params.channelType || '全部',
      sortBy: params.sortBy || null,
      contentType: params.contentType || null,
      timeRange: params.timeRange || null,
      searchScope: params.searchScope || null,
      limit: params.limit || null,
      enabled: true,
      addedAt: new Date().toISOString(),
      channels: Array.isArray(params.channels) && params.channels.length ? params.channels : null,
    });
  } else {
    return { ok: false, error: `unsupported type: ${params.type}` };
  }
  cfgMod.saveConfig(config);
  return { ok: true, type: params.type };
}

async function removeTarget(params) {
  if (!params || !params.type) return { ok: false, error: 'type required ("user" | "search")' };
  const config = _loadOrInit();
  let removed = 0;
  if (params.type === 'user') {
    const value = params.username || params.userId;
    if (!value) return { ok: false, error: 'username or userId required' };
    const before = config.accounts.length;
    config.accounts = config.accounts.filter((a) => (a.username || a.userId) !== value);
    removed = before - config.accounts.length;
  } else if (params.type === 'search') {
    if (!params.keyword) return { ok: false, error: 'keyword required' };
    const before = config.searches.length;
    config.searches = config.searches.filter((s) => s.keyword !== params.keyword);
    removed = before - config.searches.length;
  } else {
    return { ok: false, error: `unsupported type: ${params.type}` };
  }
  cfgMod.saveConfig(config);
  return { ok: removed > 0, removed };
}

/**
 * test_target - 用 runCheckCore 跑单 target；不写 state，不发通知。
 */
async function testTarget(params) {
  if (!params || !params.type) return { ok: false, error: 'type required' };
  const config = _loadOrInit();
  const opts = {
    singleType: params.type === 'user' ? 'account' : params.type === 'search' ? 'search' : null,
    singleTargetId: params.username || params.userId || params.keyword || null,
    writeState: false,
  };
  if (!opts.singleType) return { ok: false, error: `unsupported type: ${params.type}` };
  if (!opts.singleTargetId) return { ok: false, error: 'target id (username/userId/keyword) required' };

  const runtime = resolveRuntimeConfig({});
  const browser = new BrowserAutomation(runtime.serverUrl, {
    logger: { info: () => {}, warn: console.error, error: console.error },
  });
  try {
    const result = await runCheckCore({
      config,
      browser,
      options: Object.assign(opts, { recording: runtime.recording }),
    });
    return result;
  } finally {
    try { browser.disconnect(); } catch {}
  }
}

const MONITOR_TOOL_DEFINITIONS = [
  {
    name: 'xhs_monitor_list_targets',
    label: 'XHS Monitor: List Targets',
    description: '列出小红书 monitor 当前所有 accounts 与 searches target，以及 channel 列表（不触发 webhook）。',
    interactive: false,
    destructive: false,
    parameters: { type: 'object', properties: {} },
    execute: async () => listTargets(),
  },
  {
    name: 'xhs_monitor_get_status',
    label: 'XHS Monitor: Get Status',
    description: '读取 monitor daemon 状态与各 target 上一次 check 摘要（不触发 webhook）。',
    interactive: false,
    destructive: false,
    parameters: { type: 'object', properties: {} },
    execute: async () => getStatus(),
  },
  {
    name: 'xhs_monitor_add_target',
    label: 'XHS Monitor: Add Target',
    description: '添加一个 monitor target（user 或 search）。仅写 config，不触发 webhook。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'search'] },
        username: { type: 'string', description: 'type=user 时的小红书用户名（与 userId 二选一）' },
        userId: { type: 'string', description: 'type=user 时的用户 ID' },
        keyword: { type: 'string', description: 'type=search 时的关键词' },
        channelType: { type: 'string', enum: ['全部', '图文', '视频', '用户'] },
        sortBy: { type: 'string' },
        contentType: { type: 'string' },
        timeRange: { type: 'string' },
        searchScope: { type: 'string' },
        limit: { type: 'number' },
        channels: { type: 'array', items: { type: 'string' }, description: '指定要发送的 channel 名称（缺省用全局 channels）' },
      },
      required: ['type'],
    },
    execute: async (_runtime, params) => addTarget(params || {}),
  },
  {
    name: 'xhs_monitor_remove_target',
    label: 'XHS Monitor: Remove Target',
    description: '从 monitor 配置中删除一个 target。仅写 config，不触发 webhook。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'search'] },
        username: { type: 'string' },
        userId: { type: 'string' },
        keyword: { type: 'string' },
      },
      required: ['type'],
    },
    execute: async (_runtime, params) => removeTarget(params || {}),
  },
  {
    name: 'xhs_monitor_test_target',
    label: 'XHS Monitor: Test Target',
    description: '对单个 target 跑一次 runCheckCore（抓取 + 去重），但**不写 state**、**不发通知**。安全用于调试。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'search'] },
        username: { type: 'string' },
        userId: { type: 'string' },
        keyword: { type: 'string' },
      },
      required: ['type'],
    },
    execute: async (_runtime, params) => testTarget(params || {}),
  },
];

module.exports = {
  listTargets,
  getStatus,
  addTarget,
  removeTarget,
  testTarget,
  MONITOR_TOOL_DEFINITIONS,
};
