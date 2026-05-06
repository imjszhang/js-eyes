'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { COMMANDS, parseArgv } = require('../lib/commands');

test('commands include read, special, navigate, and monitor entries', () => {
  assert.equal(COMMANDS.answer.kind, 'tool');
  assert.equal(COMMANDS.article.kind, 'tool');
  assert.equal(COMMANDS.doctor.kind, 'special');
  assert.equal(COMMANDS.records.kind, 'special');
  assert.equal(COMMANDS.monitor.kind, 'special');
  assert.equal(COMMANDS['navigate-answer'].kind, 'navigate');
});

test('parseArgv supports common recording and visual flags', () => {
  const { opts, positional } = parseArgv([
    'https://www.zhihu.com/question/1/answer/2',
    '--pretty',
    '--recording-mode',
    'debug',
    '--visual-trace',
    '--limit=5',
    '--rate-limit',
  ]);
  assert.deepEqual(positional, ['https://www.zhihu.com/question/1/answer/2']);
  assert.equal(opts.pretty, true);
  assert.equal(opts.recordingMode, 'debug');
  assert.equal(opts.visualTrace, true);
  assert.equal(opts.limit, '5');
  assert.equal(opts.rateLimit, true);
});

test('parseArgv rejects unknown options', () => {
  assert.throws(() => parseArgv(['--not-real']), /unknown option/);
});
