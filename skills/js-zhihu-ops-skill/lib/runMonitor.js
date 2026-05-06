'use strict';

const { loadConfig, saveConfig, initConfig, exists } = require('./monitor/config');
const targets = require('./toolTargets');

const MONITOR_TARGET_TYPES = ['user', 'question', 'search'];

function normalizeTargetType(type) {
  const value = String(type || '').trim().toLowerCase();
  return MONITOR_TARGET_TYPES.includes(value) ? value : null;
}

function listTargets() {
  const config = loadConfig();
  return {
    ok: true,
    users: config.users || [],
    questions: config.questions || [],
    searches: config.searches || [],
    channels: config.channels || [],
  };
}

function getStatus() {
  return {
    ok: true,
    initialized: exists(),
    daemon: { running: false, pid: null },
    targets: exists() ? listTargets() : { users: [], questions: [], searches: [], channels: [] },
  };
}

function addTarget(args = {}) {
  const type = normalizeTargetType(args.type);
  const config = loadConfig();
  const now = new Date().toISOString();
  if (type === 'user') {
    const item = { userSlug: args.userSlug || args.userId || null, url: args.url || null, enabled: args.enabled !== false, addedAt: now };
    if (!item.userSlug && !item.url) return { ok: false, error: 'missing_user_target' };
    config.users.push(item);
  } else if (type === 'question') {
    const item = { questionId: args.questionId || null, url: args.url || null, enabled: args.enabled !== false, addedAt: now, limit: args.limit || undefined };
    if (!item.questionId && !item.url) return { ok: false, error: 'missing_question_target' };
    config.questions.push(item);
  } else if (type === 'search') {
    const item = { keyword: args.keyword || null, type: args.searchType || null, enabled: args.enabled !== false, addedAt: now, limit: args.limit || undefined };
    if (!item.keyword) return { ok: false, error: 'missing_keyword' };
    config.searches.push(item);
  } else {
    return { ok: false, error: 'bad_target_type', type: args.type, supportedTypes: MONITOR_TARGET_TYPES };
  }
  const configFile = saveConfig(config);
  return { ok: true, configFile, targets: listTargets() };
}

function removeTarget(args = {}) {
  const type = normalizeTargetType(args.type);
  const value = args.value || args.userSlug || args.questionId || args.keyword || args.url;
  if (!value) return { ok: false, error: 'missing_value' };
  const config = loadConfig();
  const key = type === 'user' ? 'users' : type === 'question' ? 'questions' : type === 'search' ? 'searches' : null;
  if (!key) return { ok: false, error: 'bad_target_type', type: args.type, supportedTypes: MONITOR_TARGET_TYPES };
  const before = config[key].length;
  config[key] = config[key].filter((item) => ![
    item.userSlug,
    item.userId,
    item.questionId,
    item.keyword,
    item.url,
  ].includes(value));
  const removed = before - config[key].length;
  const configFile = saveConfig(config);
  return { ok: true, removed, configFile, targets: listTargets() };
}

function testTarget(args = {}) {
  const type = normalizeTargetType(args.type);
  if (type === 'user') return { ok: true, dryRun: true, type, targetUrl: targets.userUrl(args) };
  if (type === 'question') return { ok: true, dryRun: true, type, targetUrl: targets.questionUrl(args) };
  if (type === 'search') return { ok: true, dryRun: true, type, targetUrl: targets.searchUrl({ keyword: args.keyword, type: args.searchType }) };
  return { ok: false, error: 'bad_target_type', type: args.type, supportedTypes: MONITOR_TARGET_TYPES };
}

const MONITOR_TOOL_DEFINITIONS = [
  {
    name: 'zhihu_monitor_list_targets',
    label: 'Zhihu Monitor: List Targets',
    description: '列出知乎 monitor users/questions/searches/channels。',
    interactive: false,
    destructive: false,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => listTargets(),
  },
  {
    name: 'zhihu_monitor_get_status',
    label: 'Zhihu Monitor: Get Status',
    description: '读取知乎 monitor 初始化和 daemon 状态。',
    interactive: false,
    destructive: false,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => getStatus(),
  },
  {
    name: 'zhihu_monitor_add_target',
    label: 'Zhihu Monitor: Add Target',
    description: '增加一个 user/question/search target（仅写 config，不发通知）。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'question', 'search'] },
        userSlug: { type: 'string' },
        questionId: { type: 'string' },
        keyword: { type: 'string' },
        url: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['type'],
    },
    execute: async (_runtime, params) => addTarget(params || {}),
  },
  {
    name: 'zhihu_monitor_remove_target',
    label: 'Zhihu Monitor: Remove Target',
    description: '删除一个 user/question/search target。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'question', 'search'] },
        value: { type: 'string' },
      },
      required: ['type', 'value'],
    },
    execute: async (_runtime, params) => removeTarget(params || {}),
  },
  {
    name: 'zhihu_monitor_test_target',
    label: 'Zhihu Monitor: Test Target',
    description: '单 target dry run（不写 state、不发通知）。',
    interactive: false,
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'question', 'search'] },
        userSlug: { type: 'string' },
        questionId: { type: 'string' },
        keyword: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['type'],
    },
    execute: async (_runtime, params) => testTarget(params || {}),
  },
];

module.exports = {
  MONITOR_TARGET_TYPES,
  normalizeTargetType,
  initConfig,
  listTargets,
  getStatus,
  addTarget,
  removeTarget,
  testTarget,
  MONITOR_TOOL_DEFINITIONS,
};
