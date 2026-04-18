'use strict';

/**
 * npm publish 封装：
 *   - publish(distDir)：发布 dist/js-eyes 这种预构建好的单体包。
 *   - publishFromSource(pkgDir)：直接从工作区源目录发布（@js-eyes/* scope 包）。
 * 两者都通过 NPM_TOKEN 鉴权；临时 .npmrc 写在系统 tmpdir，不污染目标目录。
 * 发布失败不吞错。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const NPMRC_CONTENT =
  'registry=https://registry.npmjs.org/\n' +
  '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n';

function requireToken() {
  if (!process.env.NPM_TOKEN) {
    throw new Error(
      'npm publish: NPM_TOKEN not set (put npm_key=... in .env or export NPM_TOKEN)'
    );
  }
}

function withNpmrc(fn) {
  const npmrc = path.join(os.tmpdir(), `.npmrc.js-eyes-${process.pid}-${Date.now()}`);
  fs.writeFileSync(npmrc, NPMRC_CONTENT);
  try {
    return fn(npmrc);
  } finally {
    try {
      fs.unlinkSync(npmrc);
    } catch {
      // ignore
    }
  }
}

function publish(distDir, { dryRun = false, tag = 'latest' } = {}) {
  if (!fs.existsSync(path.join(distDir, 'package.json'))) {
    throw new Error(`npm publish: missing package.json in ${distDir}`);
  }
  requireToken();

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

function publishFromSource(pkgDir, { dryRun = false, tag = 'latest' } = {}) {
  const manifest = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(manifest)) {
    throw new Error(`npm publish: missing package.json in ${pkgDir}`);
  }
  requireToken();

  return withNpmrc((npmrc) => {
    const args = ['publish', '--access', 'public', '--tag', tag, '--userconfig', npmrc];
    if (dryRun) args.push('--dry-run');

    try {
      const output = execFileSync('npm', args, {
        cwd: pkgDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
      return { stdout: output };
    } catch (err) {
      const stderr = err.stderr?.toString().trim() || err.message;
      throw new Error(`npm publish failed for ${pkgDir}: ${stderr}`);
    }
  });
}

function versionExists(pkgName, version) {
  try {
    const out = execFileSync('npm', ['view', `${pkgName}@${version}`, 'version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim() === version;
  } catch {
    return false;
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

module.exports = { publish, publishFromSource, versionExists, whoami };
