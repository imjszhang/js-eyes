'use strict';

const {
  MONITOR_TARGET_TYPES,
  normalizeTargetType,
  initConfig,
  listTargets,
  getStatus,
  addTarget,
  removeTarget,
  testTarget,
} = require('../runMonitor');

function emitJson(value, opts = {}) {
  process.stdout.write((opts.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n');
}

function parseArgs(argv) {
  const opts = { pretty: false, force: false, limit: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pretty') opts.pretty = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a.startsWith('--limit=')) opts.limit = Number(a.slice('--limit='.length));
    else positional.push(a);
  }
  return { opts, positional };
}

function buildTarget(type, positional, opts) {
  const normalizedType = normalizeTargetType(type);
  if (!normalizedType) return { type };
  if (normalizedType === 'user') return { type: normalizedType, userSlug: positional[0], url: /^https?:/i.test(positional[0] || '') ? positional[0] : undefined, limit: opts.limit || undefined };
  if (normalizedType === 'question') return { type: normalizedType, questionId: positional[0], url: /^https?:/i.test(positional[0] || '') ? positional[0] : undefined, limit: opts.limit || undefined };
  if (normalizedType === 'search') return { type: normalizedType, keyword: positional[0], limit: opts.limit || undefined };
  return { type };
}

async function dispatch(argv = []) {
  const sub = argv[0];
  const { opts, positional } = parseArgs(argv.slice(1));
  if (!sub || sub === '-h' || sub === '--help') {
    process.stdout.write([
      'Usage: node index.js monitor <command> [args] [options]',
      '',
      'Commands:',
      '  init [--force]',
      '  list',
      '  status',
      '  add user <slug|url>',
      '  add question <questionId|url>',
      '  add search <keyword>',
      `  remove ${MONITOR_TARGET_TYPES.join('|')} <value>`,
      `  test ${MONITOR_TARGET_TYPES.join('|')} <value>`,
      '',
    ].join('\n'));
    return 0;
  }
  try {
    if (sub === 'init') {
      emitJson(Object.assign({ ok: true }, initConfig({ force: opts.force })), opts);
      return 0;
    }
    if (sub === 'list') {
      emitJson(listTargets(), opts);
      return 0;
    }
    if (sub === 'status') {
      emitJson(getStatus(), opts);
      return 0;
    }
    if (sub === 'add') {
      const type = normalizeTargetType(positional[0]);
      if (!type) {
        process.stderr.write(`未知 target 类型: ${positional[0]}（支持: ${MONITOR_TARGET_TYPES.join(', ')}）\n`);
        return 2;
      }
      const result = addTarget(buildTarget(type, positional.slice(1), opts));
      emitJson(result, opts);
      return result.ok ? 0 : 1;
    }
    if (sub === 'remove') {
      const type = normalizeTargetType(positional[0]);
      if (!type) {
        process.stderr.write(`未知 target 类型: ${positional[0]}（支持: ${MONITOR_TARGET_TYPES.join(', ')}）\n`);
        return 2;
      }
      const result = removeTarget({ type, value: positional[1] });
      emitJson(result, opts);
      return result.ok ? 0 : 1;
    }
    if (sub === 'test') {
      const type = normalizeTargetType(positional[0]);
      if (!type) {
        process.stderr.write(`未知 target 类型: ${positional[0]}（支持: ${MONITOR_TARGET_TYPES.join(', ')}）\n`);
        return 2;
      }
      const result = testTarget(buildTarget(type, positional.slice(1), opts));
      emitJson(result, opts);
      return result.ok ? 0 : 1;
    }
    process.stderr.write(`未知 monitor 命令: ${sub}\n`);
    return 2;
  } catch (err) {
    emitJson({ ok: false, error: err.code || 'monitor_failed', message: err.message }, opts);
    return 1;
  }
}

module.exports = { dispatch };
