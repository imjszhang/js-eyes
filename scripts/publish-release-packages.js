#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const packageDir = path.resolve(process.argv[2] || 'release-packages');
const tag = process.argv[3] || 'latest';
const dryRun = process.argv.includes('--dry-run');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!/^[a-z][a-z0-9._-]*$/.test(tag)) throw new Error(`invalid npm tag ${tag}`);
if (!dryRun && process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('real publishing is restricted to GitHub Actions; use --dry-run locally');
}

const release = JSON.parse(fs.readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
if (!Array.isArray(release.packages) || release.packages.length === 0) {
  throw new Error('release package manifest is empty');
}

const confirmedVersion = process.env.RELEASE_PUBLISH_CONFIRMED;
for (const entry of release.packages) {
  if (!entry.name || !entry.version || !entry.filename) throw new Error('invalid release package entry');
  if (confirmedVersion && entry.version !== confirmedVersion) {
    throw new Error(`${entry.name}@${entry.version} does not match confirmed version ${confirmedVersion}`);
  }

  const existing = spawnSync(
    npmCommand,
    ['view', `${entry.name}@${entry.version}`, 'version'],
    { encoding: 'utf8', shell: false },
  );
  if (existing.status === 0 && existing.stdout.trim() === entry.version) {
    console.log(`skip existing ${entry.name}@${entry.version}`);
    continue;
  }

  const tarball = path.join(packageDir, path.basename(entry.filename));
  const args = ['publish', tarball, '--access', 'public', '--tag', tag];
  if (dryRun) args.push('--dry-run');
  const published = spawnSync(npmCommand, args, { encoding: 'utf8', shell: false, stdio: 'inherit' });
  if (published.status !== 0) throw new Error(`npm publish failed for ${entry.name}@${entry.version}`);
  console.log(`${dryRun ? 'verified' : 'published'} ${entry.name}@${entry.version}`);
}
