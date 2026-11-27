'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEST_ROOTS = ['test', 'apps', 'packages', 'skills'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'runs', 'work_dir']);

function collectTests(relativeDir, output) {
  const absoluteDir = path.join(REPO_ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir)) return;

  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) collectTests(relativePath, output);
    else if (entry.isFile() && entry.name.endsWith('.test.js')) output.push(relativePath);
  }
}

const testFiles = [];
for (const root of TEST_ROOTS) collectTests(root, testFiles);
testFiles.sort();

if (testFiles.length === 0) {
  console.error('coverage: no test files found');
  process.exit(1);
}

const coverageArgs = [
  '--test',
  '--experimental-test-coverage',
  '--test-coverage-include=apps/**/*.js',
  '--test-coverage-include=packages/**/*.js',
  '--test-coverage-include=openclaw-plugin/**/*.mjs',
  '--test-coverage-include=skills/**/*.js',
  '--test-coverage-exclude=**/tests/**',
  '--test-coverage-exclude=packages/visual-replay-hyperframes/__fixtures__/**',
  '--test-coverage-lines=50',
  '--test-coverage-branches=50',
  '--test-coverage-functions=40',
  ...testFiles,
];

console.log(`coverage: running ${testFiles.length} test files`);
const result = spawnSync(process.execPath, coverageArgs, {
  cwd: REPO_ROOT,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`coverage: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
