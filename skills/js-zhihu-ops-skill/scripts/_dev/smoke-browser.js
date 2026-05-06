'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_SAMPLES_PATH = path.join(__dirname, 'smoke-browser.samples.json');
const INDEX_PATH = path.join(__dirname, '..', '..', 'index.js');

const STEP_DEFS = [
  { id: 'session-state', command: 'session-state', required: [] },
  { id: 'user', command: 'user', required: ['userSlug'] },
  { id: 'user-answers', command: 'user-answers', required: ['userSlug'], limitKey: 'userAnswers', maxPagesKey: 'userAnswers' },
  { id: 'answer', command: 'answer', required: ['answerUrl'] },
  { id: 'article', command: 'article', required: ['articleUrl'] },
  { id: 'search', command: 'search', required: ['searchKeyword'], limitKey: 'search', maxPagesKey: 'search' },
  { id: 'question-answers', command: 'question-answers', required: ['questionId'], limitKey: 'questionAnswers', maxPagesKey: 'questionAnswers' },
];

function printHelp(stream = process.stdout) {
  stream.write([
    'js-zhihu-ops-skill browser smoke',
    '',
    'Usage: node scripts/_dev/smoke-browser.js [options]',
    '',
    'Options:',
    '  --server <ws-url>           js-eyes WS endpoint',
    `  --timeout-ms <ms>          timeout per CLI call (default ${DEFAULT_TIMEOUT_MS})`,
    '  --samples <path>           sample JSON path',
    '  --only <ids>               comma-separated step ids',
    '  --continue-on-error        run remaining steps after a failure',
    '  --recording-mode <mode>    off|history|standard|debug',
    '  -h, --help                 show help',
    '',
    'Step ids:',
    `  ${STEP_DEFS.map((s) => s.id).join(', ')}`,
    '',
  ].join('\n'));
}

function parseArgs(argv) {
  const opts = {
    server: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    samplesPath: DEFAULT_SAMPLES_PATH,
    only: null,
    continueOnError: false,
    recordingMode: null,
    help: false,
  };

  const eat = (args, index, name) => {
    const value = args[index + 1];
    if (value == null || value.startsWith('-')) throw new Error(`${name} requires a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--continue-on-error') opts.continueOnError = true;
    else if (arg === '--server') { opts.server = eat(argv, i, arg); i += 1; }
    else if (arg.startsWith('--server=')) opts.server = arg.slice('--server='.length);
    else if (arg === '--timeout-ms') { opts.timeoutMs = Number(eat(argv, i, arg)); i += 1; }
    else if (arg.startsWith('--timeout-ms=')) opts.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    else if (arg === '--samples') { opts.samplesPath = eat(argv, i, arg); i += 1; }
    else if (arg.startsWith('--samples=')) opts.samplesPath = arg.slice('--samples='.length);
    else if (arg === '--only') { opts.only = splitList(eat(argv, i, arg)); i += 1; }
    else if (arg.startsWith('--only=')) opts.only = splitList(arg.slice('--only='.length));
    else if (arg === '--recording-mode') { opts.recordingMode = eat(argv, i, arg); i += 1; }
    else if (arg.startsWith('--recording-mode=')) opts.recordingMode = arg.slice('--recording-mode='.length);
    else throw new Error(`unknown option: ${arg}`);
  }

  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number');
  }

  return opts;
}

function splitList(value) {
  const items = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : null;
}

function loadSamples(filePath = DEFAULT_SAMPLES_PATH) {
  const resolved = path.resolve(filePath);
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return Object.assign({
    limits: {},
    maxPages: {},
    sampleHealth: {
      minFilledFields: 5,
      minListSampleCount: 3,
      replaceStrategy: 'prefer_latest_public_url',
      lastReviewedAt: null,
    },
  }, data);
}

function valueForStep(samples, step) {
  switch (step.id) {
    case 'user':
    case 'user-answers':
      return samples.userSlug || samples.userUrl;
    case 'answer':
      return samples.answerUrl;
    case 'article':
      return samples.articleUrl;
    case 'search':
      return samples.searchKeyword;
    case 'question-answers':
      return samples.questionId || samples.questionUrl;
    default:
      return null;
  }
}

function validateSamples(samples, steps = STEP_DEFS) {
  const missing = [];
  for (const step of steps) {
    for (const key of step.required) {
      if (!samples[key] && !(key === 'userSlug' && samples.userUrl) && !(key === 'questionId' && samples.questionUrl)) {
        missing.push(`${step.id}.${key}`);
      }
    }
  }
  const requiredSampleFields = ['userSlug', 'answerUrl', 'articleUrl', 'searchKeyword', 'questionId'];
  const filledFields = requiredSampleFields.filter((key) => nonEmptyString(samples[key])).length;
  const minFilledFields = Number(samples.sampleHealth && samples.sampleHealth.minFilledFields) || requiredSampleFields.length;
  if (filledFields < minFilledFields) {
    missing.push(`sampleHealth.minFilledFields(${filledFields}/${minFilledFields})`);
  }
  const listSampleCount = ['userAnswers', 'search', 'questionAnswers']
    .filter((key) => Number(samples.limits && samples.limits[key]) > 0).length;
  const minListSampleCount = Number(samples.sampleHealth && samples.sampleHealth.minListSampleCount) || 3;
  if (listSampleCount < minListSampleCount) {
    missing.push(`sampleHealth.minListSampleCount(${listSampleCount}/${minListSampleCount})`);
  }
  return missing;
}

function buildSteps(samples, opts = {}) {
  const selected = opts.only ? new Set(opts.only) : null;
  const unknown = selected
    ? Array.from(selected).filter((id) => !STEP_DEFS.some((step) => step.id === id))
    : [];
  if (unknown.length) throw new Error(`unknown smoke step: ${unknown.join(', ')}`);

  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const steps = [];
  for (const def of STEP_DEFS) {
    if (selected && !selected.has(def.id)) continue;
    const args = [def.command];
    const value = valueForStep(samples, def);
    if (value) args.push(value);
    if (def.limitKey) {
      const limit = samples.limits && samples.limits[def.limitKey];
      if (limit != null) args.push('--limit', String(limit));
    }
    if (def.maxPagesKey) {
      const maxPages = samples.maxPages && samples.maxPages[def.maxPagesKey];
      if (maxPages != null) args.push('--max-pages', String(maxPages));
    }
    args.push('--json', '--no-cache', '--timeout-ms', String(timeoutMs));
    if (opts.server) args.push('--server', opts.server);
    if (opts.recordingMode) args.push('--recording-mode', opts.recordingMode);
    steps.push({ id: def.id, command: def.command, args });
  }
  return steps;
}

function parseJsonOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/^[{\[]/.test(lines[i])) continue;
    try { return JSON.parse(lines[i]); } catch (_) {}
  }
  throw new Error('stdout did not contain JSON');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function evaluateResult(stepId, payload) {
  if (!payload || payload.ok !== true) {
    return { ok: false, reason: payload && payload.error ? payload.error.code || payload.error.message : 'ok_not_true' };
  }
  const result = payload.result || {};
  if (stepId === 'session-state') {
    return result.state || result.cookieFlags ? { ok: true } : { ok: false, reason: 'missing_session_state' };
  }
  if (stepId === 'answer' || stepId === 'article') {
    return nonEmptyString(result.title) && nonEmptyString(result.content)
      ? { ok: true }
      : { ok: false, reason: 'missing_title_or_content' };
  }
  if (stepId === 'user') {
    return nonEmptyString(result.name) || nonEmptyString(result.user_slug)
      ? { ok: true }
      : { ok: false, reason: 'missing_user_profile' };
  }
  if (stepId === 'user-answers') {
    const items = Array.isArray(result.answers) ? result.answers : result.items;
    if (!Array.isArray(items) || items.length === 0) return { ok: false, reason: 'empty_user_answers' };
    return pageInfoMatches(result.pageInfo, items.length);
  }
  if (stepId === 'search') {
    if (!Array.isArray(result.items) || result.items.length === 0) return { ok: false, reason: 'empty_search_results' };
    return pageInfoMatches(result.pageInfo, result.items.length);
  }
  if (stepId === 'question-answers') {
    if (!Array.isArray(result.answers) || result.answers.length === 0) return { ok: false, reason: 'empty_question_answers' };
    return pageInfoMatches(result.pageInfo, result.answers.length);
  }
  return { ok: true };
}

function pageInfoMatches(pageInfo, length) {
  if (!pageInfo || typeof pageInfo !== 'object') return { ok: false, reason: 'missing_page_info' };
  if (pageInfo.returnedCount !== length) return { ok: false, reason: 'page_info_count_mismatch' };
  if (!['limit', 'no_new_items', 'max_pages', 'blocked'].includes(pageInfo.endedReason)) {
    return { ok: false, reason: 'bad_page_info_ended_reason' };
  }
  return { ok: true };
}

function runStep(step, spawnImpl = spawn) {
  return new Promise((resolve) => {
    const child = spawnImpl(process.execPath, [INDEX_PATH, ...step.args], {
      cwd: path.join(__dirname, '..', '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      resolve({ step, exitCode: 1, stdout, stderr, error: error.message });
    });
    child.on('close', (exitCode) => {
      let payload = null;
      let evaluation = null;
      let parseError = null;
      try {
        payload = parseJsonOutput(stdout);
        evaluation = evaluateResult(step.id, payload);
      } catch (error) {
        parseError = error.message;
        evaluation = { ok: false, reason: parseError };
      }
      resolve({ step, exitCode, stdout, stderr, payload, evaluation, parseError });
    });
  });
}

function summarize(results) {
  const passed = results.filter((item) => item.exitCode === 0 && item.evaluation && item.evaluation.ok).length;
  const failed = results.length - passed;
  return { ok: failed === 0, total: results.length, passed, failed };
}

async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`参数错误: ${error.message}\n`);
    printHelp(process.stderr);
    return 2;
  }
  if (opts.help) {
    printHelp();
    return 0;
  }

  let samples;
  try {
    samples = loadSamples(opts.samplesPath);
  } catch (error) {
    process.stderr.write(`读取样本失败: ${error.message}\n`);
    return 2;
  }

  let steps;
  try {
    steps = buildSteps(samples, opts);
    const missing = validateSamples(samples, STEP_DEFS.filter((step) => !opts.only || opts.only.includes(step.id)));
    if (missing.length) throw new Error(`missing samples: ${missing.join(', ')}`);
  } catch (error) {
    process.stderr.write(`构造 smoke 步骤失败: ${error.message}\n`);
    return 2;
  }

  const results = [];
  for (const step of steps) {
    process.stderr.write(`[zhihu-smoke] run ${step.id}: node index.js ${step.args.join(' ')}\n`);
    const result = await runStep(step);
    results.push(result);
    const passed = result.exitCode === 0 && result.evaluation && result.evaluation.ok;
    if (passed) {
      process.stderr.write(`[zhihu-smoke] pass ${step.id}\n`);
    } else {
      const reason = (result.evaluation && result.evaluation.reason) || result.error || `exit ${result.exitCode}`;
      process.stderr.write(`[zhihu-smoke] fail ${step.id}: ${reason}\n`);
      if (result.stderr) process.stderr.write(result.stderr);
      if (!opts.continueOnError) break;
    }
  }

  const summary = summarize(results);
  process.stdout.write(JSON.stringify({
    ok: summary.ok,
    summary,
    results: results.map((item) => ({
      id: item.step.id,
      command: item.step.command,
      exitCode: item.exitCode,
      ok: item.exitCode === 0 && item.evaluation && item.evaluation.ok,
      reason: item.evaluation && item.evaluation.reason || null,
    })),
  }, null, 2) + '\n');
  return summary.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    process.stderr.write(`Fatal: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_SAMPLES_PATH,
  STEP_DEFS,
  parseArgs,
  loadSamples,
  validateSamples,
  buildSteps,
  parseJsonOutput,
  evaluateResult,
  pageInfoMatches,
  summarize,
  main,
};
