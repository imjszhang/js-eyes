'use strict';

/**
 * ClawHub publish 封装：依赖全局 `clawhub` CLI（npm install -g clawhub）。
 *
 * 鉴权优先级：
 *   1. 进程环境 CLAWHUB_TOKEN（从 .env 读入）
 *   2. `clawhub` CLI 本地配置（~/.config/clawhub/config.json 或 macOS 对应路径）
 *
 * 当 CLI 未安装时抛错；登录状态不足时，若有 CLAWHUB_TOKEN 走 `login --token`
 * 临时登录；都不具备时抛错由上层决定是否跳过。
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function available() {
  try {
    execFileSync('clawhub', ['--help'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function runClawhub(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('clawhub', args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
  } catch (err) {
    if (allowFailure) return null;
    const stderr = err.stderr?.toString().trim() || err.message;
    throw new Error(`clawhub ${args[0]} failed: ${stderr}`);
  }
}

function whoami() {
  try {
    const output = execFileSync('clawhub', ['whoami'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // clawhub v0.9.0+: "✔ imjszhang" (no @, optional spinner prefix).
    // clawhub legacy:  "✔ OK. Logged in as @imjszhang."
    // Strip ANSI so spinner libs don't confuse the regex.
    const clean = output.replace(/\u001b\[[0-9;]*m/g, '');
    const match =
      clean.match(/✔\s+OK\.\s+Logged in as @([\w-]+)/) ||
      clean.match(/@([\w-]+)/) ||
      clean.match(/✔\s+([\w-]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function ensureLoggedIn() {
  const who = whoami();
  if (who) return who;

  if (process.env.CLAWHUB_TOKEN) {
    runClawhub(['login', '--no-browser', '--token', process.env.CLAWHUB_TOKEN]);
    const after = whoami();
    if (!after) throw new Error('clawhub login --token succeeded but whoami still fails');
    return after;
  }

  throw new Error(
    'clawhub not logged in (run `clawhub login` once, or put CLAWHUB_TOKEN in .env)'
  );
}

function publish({ skillDir, slug, version, changelog, tags, dryRun = false }) {
  if (!available()) {
    throw new Error('clawhub CLI not installed (npm install -g clawhub)');
  }
  if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
    throw new Error(`clawhub publish: ${skillDir} is missing SKILL.md`);
  }

  const who = ensureLoggedIn();

  const args = ['publish', skillDir, '--slug', slug, '--version', version];
  if (changelog) args.push('--changelog', changelog);
  if (tags) args.push('--tags', tags);

  if (dryRun) {
    return { skipped: true, who, args };
  }

  const output = runClawhub(args);
  // 示例输出最后一行: "✔ OK. Published js-eyes@2.3.0 (k97dfqmb...)"
  const idMatch = output.match(/\(([a-z0-9]{16,})\)/);
  return {
    who,
    id: idMatch ? idMatch[1] : null,
    stdout: output,
  };
}

module.exports = { available, whoami, ensureLoggedIn, publish };
