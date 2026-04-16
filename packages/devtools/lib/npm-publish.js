'use strict';

/**
 * npm publish 封装：在 dist/js-eyes 下写入临时 .npmrc 使用 NPM_TOKEN 鉴权，
 * 完成后删除 .npmrc。发布失败不吞错。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NPMRC_CONTENT =
  'registry=https://registry.npmjs.org/\n' +
  '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n';

function publish(distDir, { dryRun = false, tag = 'latest' } = {}) {
  if (!fs.existsSync(path.join(distDir, 'package.json'))) {
    throw new Error(`npm publish: missing package.json in ${distDir}`);
  }
  if (!process.env.NPM_TOKEN) {
    throw new Error(
      'npm publish: NPM_TOKEN not set (put npm_key=... in .env or export NPM_TOKEN)'
    );
  }

  const npmrc = path.join(distDir, '.npmrc');
  fs.writeFileSync(npmrc, NPMRC_CONTENT);

  const args = ['publish', '--access', 'public', '--tag', tag];
  if (dryRun) args.push('--dry-run');

  try {
    const output = execFileSync('npm', args, {
      cwd: distDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    return { stdout: output };
  } catch (err) {
    const stderr = err.stderr?.toString().trim() || err.message;
    throw new Error(`npm publish failed: ${stderr}`);
  } finally {
    try {
      fs.unlinkSync(npmrc);
    } catch {
      // ignore
    }
  }
}

function whoami() {
  if (!process.env.NPM_TOKEN) return null;
  const tmpDir = require('os').tmpdir();
  const npmrc = path.join(tmpDir, `.npmrc.js-eyes-${process.pid}`);
  fs.writeFileSync(npmrc, NPMRC_CONTENT);
  try {
    const out = execFileSync('npm', ['whoami', '--userconfig', npmrc], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    return out.trim();
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(npmrc);
    } catch {
      // ignore
    }
  }
}

module.exports = { publish, whoami };
