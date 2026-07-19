'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const cliRoot = path.join(repoRoot, 'apps/cli/src');

function read(relativePath) {
  return fs.readFileSync(path.join(cliRoot, relativePath), 'utf8');
}

function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  const chunks = [];
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  return Promise.resolve()
    .then(fn)
    .then(() => chunks.join(''))
    .finally(() => {
      process.stdout.write = originalWrite;
    });
}

describe('CLI module boundaries', () => {
  it('keeps cli.js as a thin router with the compatibility export surface', () => {
    const source = read('cli.js');
    assert.ok(source.split('\n').length <= 300, 'cli.js must remain a thin entrypoint');
    assert.doesNotMatch(source, /require\(['"]@js-eyes\//);
    assert.doesNotMatch(source, /require\(['"](?:fs|path|child_process)['"]\)/);

    const exported = Object.keys(require('../apps/cli/src/cli')).sort();
    assert.deepEqual(exported, [
      'commandDoctor',
      'commandEgress',
      'commandExtension',
      'commandNativeHost',
      'commandSecurity',
      'commandSkill',
      'commandSkills',
      'commandStatus',
      'compareSemver',
      'flagsToArgv',
      'getLoopbackOrigin',
      'getServerOptions',
      'isProcessAlive',
      'main',
      'parseArgs',
      'parseSemver',
      'readPid',
      'resolveExtensionAsset',
      'resolvePluginPath',
    ].sort());
  });

  it('keeps command modules independent from the CLI entrypoint', () => {
    const commandFiles = [];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.name.endsWith('.js')) commandFiles.push(absolute);
      }
    };
    visit(path.join(cliRoot, 'commands'));

    assert.ok(commandFiles.length >= 19);
    for (const file of commandFiles) {
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /require\(['"][^'"]*\/cli['"]\)/, path.relative(repoRoot, file));
      assert.ok(source.split('\n').length <= 700, `${path.relative(repoRoot, file)} is a new hotspot`);
    }
  });

  it('preserves help dispatch and unknown-command errors', async () => {
    const { main } = require('../apps/cli/src/cli');
    const output = await captureStdout(() => main(['help']));
    assert.match(output, /^JS Eyes CLI/m);
    assert.match(output, /js-eyes skills update/);
    assert.match(output, /js-eyes native-host install/);
    await assert.rejects(() => main(['not-a-command']), /未知命令: not-a-command/);
  });
});
