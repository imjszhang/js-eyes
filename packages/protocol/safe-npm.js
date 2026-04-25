'use strict';

// safe-npm: the only place in this package that invokes child_process.
//
// Design constraints (see SECURITY_SCAN_NOTES.md, "Shell command execution"):
//   * subcommand is chosen from an immutable whitelist — callers can only
//     select by name, never by passing a string;
//   * every argv entry is a constant (no string concatenation from user input);
//   * spawnSync is called with `shell: false` and `windowsHide: true`;
//   * the child env is built from a small whitelist, so secrets in
//     process.env (tokens, OAuth state, etc.) never leak into the npm run;
//   * postinstall scripts are disabled unless the caller explicitly opts in.
//
// The single allowed binary name is `npm`. No wildcards, no PATHEXT, no shell
// meta-characters: Node's child_process with shell=false treats the argv as a
// literal argument vector.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ALLOWED_SUBCOMMANDS = Object.freeze({
  ci: Object.freeze(['ci', '--no-audit', '--no-fund']),
  install: Object.freeze(['install', '--no-audit', '--no-fund']),
});

const SAFE_ENV_KEYS = Object.freeze([
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'SystemRoot',
  'SYSTEMROOT',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PATHEXT',
]);

function buildSafeEnv(sourceEnv, extra = {}) {
  const src = sourceEnv || process.env;
  const next = {};
  for (const key of SAFE_ENV_KEYS) {
    if (src[key] !== undefined) next[key] = src[key];
  }
  for (const [key, value] of Object.entries(src)) {
    if (key.startsWith('npm_config_')) next[key] = value;
  }
  for (const [key, value] of Object.entries(extra || {})) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function detectPackageManager(targetDir) {
  if (fs.existsSync(path.join(targetDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(targetDir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(targetDir, 'package-lock.json'))) return 'npm';
  return null;
}

function runNpm(subcommand, targetDir, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_SUBCOMMANDS, subcommand)) {
    throw new Error(`safe-npm: subcommand "${subcommand}" is not in the allowlist`);
  }
  if (typeof targetDir !== 'string' || !targetDir) {
    throw new Error('safe-npm: targetDir must be a non-empty string');
  }

  const baseArgs = ALLOWED_SUBCOMMANDS[subcommand].slice();
  const allowPostinstall = Boolean(options.allowPostinstall);
  if (!allowPostinstall) baseArgs.push('--ignore-scripts');

  const childEnv = buildSafeEnv(options.env || process.env, {
    npm_config_ignore_scripts: allowPostinstall ? 'false' : 'true',
  });

  const result = spawnSync('npm', baseArgs, {
    cwd: targetDir,
    stdio: options.stdio || 'pipe',
    shell: false,
    windowsHide: true,
    env: childEnv,
  });

  return { result, args: baseArgs };
}

function safeNpmCi(targetDir, options = {}) {
  const { result, args } = runNpm('ci', targetDir, options);
  if (result.status !== 0) {
    const stderr = result.stderr ? String(result.stderr) : '';
    throw new Error(`npm ${args.join(' ')} 失败 (status=${result.status}): ${stderr.slice(0, 500)}`);
  }
  return { ran: true, manager: 'npm', args };
}

function safeNpmInstall(targetDir, options = {}) {
  const { result, args } = runNpm('install', targetDir, options);
  if (result.status !== 0) {
    const stderr = result.stderr ? String(result.stderr) : '';
    throw new Error(`npm ${args.join(' ')} 失败 (status=${result.status}): ${stderr.slice(0, 500)}`);
  }
  return { ran: true, manager: 'npm', args };
}

function installSkillDependencies(targetDir, options = {}) {
  const pkgJson = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgJson)) return { ran: false, manager: null };

  const requireLockfile = options.requireLockfile !== false;
  const manager = detectPackageManager(targetDir);

  if (requireLockfile && manager !== 'npm') {
    throw new Error('安装拒绝执行：缺少 package-lock.json（开启 security.requireLockfile=false 可放宽）');
  }

  const runOptions = {
    allowPostinstall: Boolean(options.allowPostinstall),
    stdio: options.stdio,
    env: options.env,
  };

  const outcome = manager === 'npm'
    ? safeNpmCi(targetDir, runOptions)
    : safeNpmInstall(targetDir, runOptions);

  return {
    ran: true,
    manager: outcome.manager,
    allowPostinstall: runOptions.allowPostinstall,
  };
}

module.exports = {
  ALLOWED_SUBCOMMANDS,
  SAFE_ENV_KEYS,
  buildSafeEnv,
  detectPackageManager,
  safeNpmCi,
  safeNpmInstall,
  installSkillDependencies,
};
