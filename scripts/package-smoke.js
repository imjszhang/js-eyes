'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const publishableWorkspaces = [
  '@js-eyes/protocol',
  '@js-eyes/runtime-paths',
  '@js-eyes/config',
  '@js-eyes/skill-recording',
  '@js-eyes/client-sdk',
  '@js-eyes/server-core',
  '@js-eyes/native-host',
];

function fail(message) {
  process.stderr.write(`package-smoke: ${message}\n`);
  process.exitCode = 1;
}

function validateEntryFiles(workspace, packed) {
  const workspaceDir = path.dirname(require.resolve(`${workspace}/package.json`, { paths: [repoRoot] }));
  const manifest = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf8'));
  const packedFiles = new Set((packed.files || []).map((item) => item.path));
  const entries = [manifest.main || 'index.js'];

  if (typeof manifest.bin === 'string') entries.push(manifest.bin);
  if (manifest.bin && typeof manifest.bin === 'object') entries.push(...Object.values(manifest.bin));

  for (const entry of entries) {
    const normalized = String(entry).replace(/^\.\//, '');
    if (!packedFiles.has(normalized)) {
      fail(`${workspace} is missing package entry ${normalized}`);
    }
  }

  for (const item of packed.files || []) {
    const file = item.path;
    if (/(^|\/)\.env(?:\.|$)/.test(file) || /(^|\/)\.npmrc$/.test(file)) {
      fail(`${workspace} includes sensitive file ${file}`);
    }
    if (file.startsWith('runs/') || file.startsWith('work_dir/')) {
      fail(`${workspace} includes runtime artifact ${file}`);
    }
  }
}

for (const workspace of publishableWorkspaces) {
  const result = spawnSync(
    npmCommand,
    ['pack', '--dry-run', '--json', '--workspace', workspace],
    { cwd: repoRoot, encoding: 'utf8', shell: false },
  );

  if (result.status !== 0) {
    fail(`${workspace} pack failed: ${(result.stderr || result.stdout || '').trim()}`);
    continue;
  }

  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch (error) {
    fail(`${workspace} returned invalid npm pack JSON: ${error.message}`);
    continue;
  }

  const packed = output[0];
  if (!packed || packed.name !== workspace) {
    fail(`${workspace} returned unexpected pack metadata`);
    continue;
  }

  validateEntryFiles(workspace, packed);
  process.stdout.write(`✓ ${packed.id}: ${packed.entryCount} files, ${packed.size} bytes\n`);
}

if (process.exitCode) process.exit(process.exitCode);
