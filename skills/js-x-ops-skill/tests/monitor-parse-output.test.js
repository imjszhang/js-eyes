'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { parseMonitorArgs } = require('../lib/monitor/dispatcher');

const indexJs = path.join(__dirname, '..', 'index.js');

test('parseMonitorArgs: --output space form', () => {
  const { opts, positional } = parseMonitorArgs(['list', '--output', '/tmp/mon.json']);
  assert.equal(positional[0], 'list');
  assert.equal(opts.output, '/tmp/mon.json');
});

test('parseMonitorArgs: --output= form', () => {
  const { opts } = parseMonitorArgs(['init', '--output=/x/state.json']);
  assert.equal(opts.output, '/x/state.json');
});

test('monitor list --output: file matches stdout', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'js-x-monitor-cli-'));
  const env = { ...process.env, JS_X_MONITOR_HOME: home };
  try {
    execFileSync(process.execPath, [indexJs, 'monitor', 'init', '--json'], { env, encoding: 'utf8' });
    const outFile = path.join(home, 'nested', 'list-out.json');
    const stdout = execFileSync(process.execPath, [indexJs, 'monitor', 'list', '--json', '--output', outFile], {
      env,
      encoding: 'utf8',
    });
    const disk = fs.readFileSync(outFile, 'utf8');
    assert.equal(disk, stdout);
    assert.ok(stdout.includes('"ok":true'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
