#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { RELEASE_PACKAGES } = require('./release-packages');

const root = path.resolve(__dirname, '..');
const outputArg = process.argv[2] || 'dist/release-packages';
const outputDir = path.resolve(root, outputArg);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

fs.mkdirSync(outputDir, { recursive: true });
for (const file of fs.readdirSync(outputDir)) {
  if (file.endsWith('.tgz') || file === 'manifest.json') {
    fs.unlinkSync(path.join(outputDir, file));
  }
}

const releaseManifest = [];
for (const entry of RELEASE_PACKAGES) {
  const result = spawnSync(
    npmCommand,
    ['pack', '--json', '--workspace', entry.name, '--pack-destination', outputDir],
    { cwd: root, encoding: 'utf8', shell: false },
  );
  if (result.status !== 0) {
    throw new Error(`npm pack failed for ${entry.name}: ${(result.stderr || result.stdout).trim()}`);
  }

  const packed = JSON.parse(result.stdout)[0];
  if (!packed || packed.name !== entry.name || !packed.filename) {
    throw new Error(`npm pack returned unexpected metadata for ${entry.name}`);
  }
  const filename = path.basename(packed.filename);
  if (!fs.existsSync(path.join(outputDir, filename))) {
    throw new Error(`npm pack did not create ${filename}`);
  }
  releaseManifest.push({ name: packed.name, version: packed.version, filename });
  console.log(`prepared ${packed.name}@${packed.version} -> ${filename}`);
}

fs.writeFileSync(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify({ packages: releaseManifest }, null, 2)}\n`,
  'utf8',
);
