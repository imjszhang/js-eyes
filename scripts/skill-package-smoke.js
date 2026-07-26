#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildSubSkillZip,
  discoverSubSkills,
} = require('../packages/devtools/lib/build/skills-registry');
const { extractZipFile } = require('../packages/skill-install/zip-extract');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-skill-package-smoke-'));

async function main() {
  let failed = false;
  for (const skill of discoverSubSkills()) {
    const zipPath = path.join(tempRoot, `${skill.id}.zip`);
    const installDir = path.join(tempRoot, `${skill.id}-install`);
    try {
      await buildSubSkillZip(skill, zipPath);
      extractZipFile(zipPath, installDir);
      const pkg = JSON.parse(fs.readFileSync(path.join(installDir, 'package.json'), 'utf8'));
      const localSpecs = Object.values(pkg.dependencies || {})
        .filter((specifier) => String(specifier).startsWith('file:'));
      for (const specifier of localSpecs) {
        const target = path.resolve(installDir, String(specifier).slice('file:'.length));
        if (!fs.existsSync(target)) {
          throw new Error(`missing vendored dependency ${specifier}`);
        }
      }

      const result = spawnSync(npmCommand, [
        'ci',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--workspaces=false',
      ], {
        cwd: installDir,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || '').trim());
      }
      process.stdout.write(
        `✓ ${skill.id}: ZIP extract + clean-room npm ci (${localSpecs.length} local dependency path(s))\n`,
      );
    } catch (error) {
      failed = true;
      process.stderr.write(`skill-package-smoke: ${skill.id}: ${error.message}\n`);
    }
  }
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    process.stderr.write(`skill-package-smoke: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
