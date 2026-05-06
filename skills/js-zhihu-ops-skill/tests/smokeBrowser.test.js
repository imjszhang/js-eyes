'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const smoke = require('../scripts/_dev/smoke-browser');

const SAMPLE = {
  userSlug: 'alice',
  answerUrl: 'https://www.zhihu.com/question/1/answer/2',
  articleUrl: 'https://zhuanlan.zhihu.com/p/3',
  searchKeyword: '大模型',
  questionId: '1',
  limits: {
    userAnswers: 2,
    search: 4,
    questionAnswers: 3,
  },
};

test('parseArgs supports browser smoke options', () => {
  const opts = smoke.parseArgs([
    '--server', 'ws://localhost:18080',
    '--timeout-ms=60000',
    '--samples', 'local.json',
    '--only', 'answer,search',
    '--continue-on-error',
    '--recording-mode', 'debug',
  ]);

  assert.equal(opts.server, 'ws://localhost:18080');
  assert.equal(opts.timeoutMs, 60000);
  assert.equal(opts.samplesPath, 'local.json');
  assert.deepEqual(opts.only, ['answer', 'search']);
  assert.equal(opts.continueOnError, true);
  assert.equal(opts.recordingMode, 'debug');
});

test('loadSamples reads json and preserves default limits object', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-smoke-'));
  const file = path.join(dir, 'samples.json');
  fs.writeFileSync(file, JSON.stringify({ userSlug: 'alice' }), 'utf8');

  const samples = smoke.loadSamples(file);
  assert.equal(samples.userSlug, 'alice');
  assert.deepEqual(samples.limits, {});
});

test('buildSteps constructs CLI arguments without running browser', () => {
  const steps = smoke.buildSteps(SAMPLE, {
    only: ['answer', 'search'],
    timeoutMs: 60000,
    server: 'ws://localhost:18080',
    recordingMode: 'off',
  });

  assert.deepEqual(steps.map((step) => step.id), ['answer', 'search']);
  assert.deepEqual(steps[0].args, [
    'answer',
    SAMPLE.answerUrl,
    '--json',
    '--no-cache',
    '--timeout-ms',
    '60000',
    '--server',
    'ws://localhost:18080',
    '--recording-mode',
    'off',
  ]);
  assert.deepEqual(steps[1].args, [
    'search',
    SAMPLE.searchKeyword,
    '--limit',
    '4',
    '--json',
    '--no-cache',
    '--timeout-ms',
    '60000',
    '--server',
    'ws://localhost:18080',
    '--recording-mode',
    'off',
  ]);
});

test('validateSamples reports missing required fields for selected steps', () => {
  const missing = smoke.validateSamples({}, [
    { id: 'answer', required: ['answerUrl'] },
    { id: 'session-state', required: [] },
  ]);

  assert.deepEqual(missing, ['answer.answerUrl']);
});

test('parseJsonOutput reads the last JSON line', () => {
  const parsed = smoke.parseJsonOutput('noise\n{"ok":false}\n{"ok":true,"result":{"name":"alice"}}\n');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.result.name, 'alice');
});

test('evaluateResult applies per-step smoke assertions', () => {
  assert.deepEqual(smoke.evaluateResult('session-state', {
    ok: true,
    result: { cookieFlags: { hasZC0: true } },
  }), { ok: true });

  assert.deepEqual(smoke.evaluateResult('answer', {
    ok: true,
    result: { title: '标题', content: '内容' },
  }), { ok: true });

  assert.deepEqual(smoke.evaluateResult('user-answers', {
    ok: true,
    result: { answers: [{ title: '回答' }] },
  }), { ok: true });

  assert.equal(smoke.evaluateResult('search', {
    ok: true,
    result: { items: [] },
  }).ok, false);

  assert.equal(smoke.evaluateResult('question-answers', {
    ok: false,
    error: { code: 'captcha_required' },
  }).reason, 'captcha_required');
});

test('summarize converts result list to pass/fail counts', () => {
  const summary = smoke.summarize([
    { exitCode: 0, evaluation: { ok: true } },
    { exitCode: 1, evaluation: { ok: false } },
  ]);

  assert.deepEqual(summary, { ok: false, total: 2, passed: 1, failed: 1 });
});
