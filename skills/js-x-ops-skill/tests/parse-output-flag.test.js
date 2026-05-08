'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { parseArgv } = require('../lib/commands');

test('parseArgv: --output space form', () => {
  const { opts, positional } = parseArgv(['home', '--output', '/tmp/out.json', '--feed', 'foryou']);
  assert.equal(positional[0], 'home');
  assert.equal(opts.output, '/tmp/out.json');
  assert.equal(opts.feed, 'foryou');
});

test('parseArgv: --output= form', () => {
  const { opts } = parseArgv(['probe', '--output=/data/x.json']);
  assert.equal(opts.output, '/data/x.json');
});

test('parseArgv: output path resolved same as CLI would', () => {
  const rel = 'subdir/feed.json';
  const { opts } = parseArgv(['home', `--output=${rel}`]);
  assert.equal(path.resolve(opts.output), path.resolve(process.cwd(), rel));
});
