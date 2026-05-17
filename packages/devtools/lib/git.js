'use strict';

/**
 * JS Eyes Git — git operations for CLI commit, sync, and release commands.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (err) {
    const stderr = err.stderr?.trim() || err.message;
    throw new Error(`git ${args[0]} failed: ${stderr}`);
  }
}

function gitStatus() {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const porcelain = git(['status', '--porcelain']);
  const lines = porcelain ? porcelain.split('\n') : [];

  const staged = [];
  const unstaged = [];
  const untracked = [];

  for (const line of lines) {
    const match = line.match(/^(.)(.) (.+)$/);
    if (!match) continue;
    const [, x, y, file] = match;
    if (x === '?' && y === '?') {
      untracked.push(file);
    } else {
      if (x !== ' ' && x !== '?') staged.push(file);
      if (y !== ' ' && y !== '?') unstaged.push(file);
    }
  }

  return { branch, clean: lines.length === 0, staged, unstaged, untracked };
}

function gitAdd(paths) {
  if (!paths || paths.length === 0) throw new Error('gitAdd: no paths');
  git(['add', ...paths]);
}

function gitAddAll() {
  git(['add', '-A']);
}

function gitCommit(message) {
  if (!message || message.trim() === '') throw new Error('gitCommit: empty message');
  git(['commit', '-m', message]);
  const hash = git(['rev-parse', '--short', 'HEAD']);
  return { hash, message };
}

function gitPush(remote = 'origin', branch, force = false) {
  if (!branch) branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const args = ['push', remote, branch];
  if (force) args.splice(1, 0, '--force');
  git(args);
  return { remote, branch };
}

function gitDiffStat() {
  const stat = git(['diff', '--cached', '--stat']);
  const nameOnly = git(['diff', '--cached', '--name-only']);
  const files = nameOnly ? nameOnly.split('\n') : [];
  return { files, summary: stat };
}

function gitTag(tag, message) {
  if (message) {
    git(['tag', '-a', tag, '-m', message]);
  } else {
    git(['tag', tag]);
  }
}

function gitTagExists(tag) {
  try {
    git(['rev-parse', tag]);
    return true;
  } catch {
    return false;
  }
}

function generateCommitMessage(files) {
  if (!files || files.length === 0) return 'chore: update files';

  const areas = new Set();
  let hasDocs = false;
  let hasSrc = false;

  for (const file of files) {
    if (file.startsWith('docs/')) hasDocs = true;
    if (file.startsWith('src/')) hasSrc = true;

    if (file.startsWith('extensions/chrome/')) areas.add('chrome');
    else if (file.startsWith('extensions/firefox/')) areas.add('firefox');
    else if (file.startsWith('packages/')) areas.add('packages');
    else if (file.startsWith('apps/')) areas.add('apps');
    else if (file.startsWith('src/')) areas.add('site');
    else if (file.startsWith('docs/')) areas.add('docs');
    else if (file === 'install.sh' || file === 'install.ps1') areas.add('release');
    else if (file.startsWith('skills/')) areas.add('skills');
    else if (file === 'package.json' || file === 'README.md' || file === 'CHANGELOG.md') areas.add('meta');
  }

  if (hasDocs && !hasSrc && areas.size === 1 && areas.has('docs')) {
    return 'build: update site output';
  }

  const areaList = [...areas].filter((area) => area !== 'docs');

  if (areaList.length === 0) {
    return `chore: update ${files.length} file(s)`;
  }
  if (areaList.length === 1) {
    const area = areaList[0];
    if (hasDocs) return `${area}: update and rebuild`;
    return `${area}: update`;
  }

  if (hasDocs) return `update ${areaList.join(', ')} and rebuild site`;
  return `update ${areaList.join(', ')}`;
}

/** npm package `gh` is Node GH (Liferay), not GitHub CLI — it breaks `gh release create`. */
function isNpmNodeGhBinary(absPath) {
  try {
    const head = fs.readFileSync(absPath, 'utf8').slice(0, 500);
    return head.includes('Liferay') && /\bnode\s+GH\b/i.test(head);
  } catch {
    return false;
  }
}

function listGhPathCandidates() {
  const seen = new Set();
  const add = (p) => {
    if (p && typeof p === 'string') seen.add(p.trim());
  };
  add(process.env.GITHUB_CLI);
  add('/opt/homebrew/bin/gh');
  add('/usr/local/bin/gh');
  try {
    const out = execFileSync('bash', ['-lc', 'type -a gh 2>/dev/null || true'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const line of out.split('\n')) {
      const m = line.match(/^gh is (.+)$/);
      if (m) add(m[1].replace(/^aliased to `/, '').replace(/`$/, '').trim());
    }
  } catch {
    /* ignore */
  }
  try {
    const which = execFileSync('/bin/bash', ['-lc', 'command -v gh'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    add(which);
  } catch {
    /* ignore */
  }
  return [...seen].filter(Boolean);
}

/** Resolve GitHub's official `gh` binary, skipping npm's unrelated `gh` package. */
function resolveGhExecutable() {
  for (const candidate of listGhPathCandidates()) {
    if (!candidate.startsWith('/') || !fs.existsSync(candidate)) continue;
    if (isNpmNodeGhBinary(candidate)) continue;
    return candidate;
  }
  return null;
}

function parseCurlHttpBody(raw) {
  const m = raw.match(/\nHTTP_STATUS:(\d+)\s*$/);
  if (!m) return { status: 0, body: raw.trimEnd() };
  const status = Number(m[1]);
  const body = raw.slice(0, m.index).trimEnd();
  return { status, body };
}

function githubReleaseViaRestApi(tag, title, notesBody, assets, { repo, token }) {
  const parts = String(repo).split('/');
  const owner = parts[0];
  const repoName = parts[1];
  if (!owner || !repoName) throw new Error(`release: invalid repo "${repo}" (expected owner/name)`);

  let curlOk = false;
  try {
    execFileSync('curl', ['--version'], { stdio: 'pipe' });
    curlOk = true;
  } catch {
    /* ignore */
  }
  if (!curlOk) throw new Error('release: curl not found (needed for GitHub API fallback)');

  const apiRoot = `https://api.github.com/repos/${owner}/${repoName}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-ghrel-'));
  const payloadPath = path.join(tmpDir, 'release.json');
  try {
    fs.writeFileSync(
      payloadPath,
      JSON.stringify({
        tag_name: tag,
        name: title,
        body: notesBody || `Release ${tag}`,
        draft: false,
        prerelease: false,
      }),
    );

    const postArgs = [
      '-sS',
      '-w',
      '\nHTTP_STATUS:%{http_code}',
      '-X',
      'POST',
      `${apiRoot}/releases`,
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      `Authorization: Bearer ${token}`,
      '-H',
      'X-GitHub-Api-Version: 2022-11-28',
      '-H',
      'Content-Type: application/json',
      '-d',
      `@${payloadPath}`,
    ];
    const postRaw = execFileSync('curl', postArgs, { encoding: 'utf-8' });
    let { status, body } = parseCurlHttpBody(postRaw);
    let release = null;

    if (status === 201) {
      release = JSON.parse(body);
    } else if (status === 422) {
      const getUrl = `${apiRoot}/releases/tags/${encodeURIComponent(tag)}`;
      const getArgs = [
        '-sS',
        '-w',
        '\nHTTP_STATUS:%{http_code}',
        '-X',
        'GET',
        getUrl,
        '-H',
        'Accept: application/vnd.github+json',
        '-H',
        `Authorization: Bearer ${token}`,
        '-H',
        'X-GitHub-Api-Version: 2022-11-28',
      ];
      const getRaw = execFileSync('curl', getArgs, { encoding: 'utf-8' });
      const parsed = parseCurlHttpBody(getRaw);
      if (parsed.status !== 200) {
        throw new Error(`GitHub API create release failed (${status}): ${body.slice(0, 500)}`);
      }
      release = JSON.parse(parsed.body);
    } else {
      throw new Error(`GitHub API create release failed (${status}): ${body.slice(0, 500)}`);
    }

    const uploadTemplate = release.upload_url;
    if (uploadTemplate && assets.length) {
      const uploadBase = uploadTemplate.replace(/\{\?[^}]+\}$/, '');
      for (const assetPath of assets) {
        if (!fs.existsSync(assetPath)) continue;
        const base = path.basename(assetPath);
        const uploadUrl = `${uploadBase}?name=${encodeURIComponent(base)}`;
        const upArgs = [
          '-sS',
          '-w',
          '\nHTTP_STATUS:%{http_code}',
          '-X',
          'POST',
          uploadUrl,
          '-H',
          `Authorization: Bearer ${token}`,
          '-H',
          'Content-Type: application/octet-stream',
          '--data-binary',
          `@${assetPath}`,
        ];
        const upRaw = execFileSync('curl', upArgs, { encoding: 'utf-8' });
        const up = parseCurlHttpBody(upRaw);
        if (up.status !== 201 && up.status !== 200) {
          const msg = up.body.slice(0, 400);
          if (!/already_exists/i.test(msg)) {
            throw new Error(`GitHub API upload asset ${base} failed (${up.status}): ${msg}`);
          }
        }
      }
    }

    const url = release.html_url || release.url || `${apiRoot}/releases/tag/${encodeURIComponent(tag)}`;
    return url;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function ghRelease(tag, title, notes, assets = [], options = {}) {
  const repo = options.repo || 'imjszhang/js-eyes';
  const notesBody = options.notesFile ? fs.readFileSync(options.notesFile, 'utf8') : notes || `Release ${tag}`;

  const ghExe = resolveGhExecutable();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  if (ghExe) {
    const args = ['release', 'create', tag, '--title', title];
    if (options.notesFile) {
      args.push('--notes-file', options.notesFile);
    } else {
      args.push('--notes', notesBody);
    }
    args.push('--repo', repo);
    for (const asset of assets) {
      args.push(asset);
    }

    const env = { ...process.env };
    if (!env.GH_TOKEN && env.GITHUB_TOKEN) {
      env.GH_TOKEN = env.GITHUB_TOKEN;
    }
    if (!env.CI) env.CI = 'true';
    if (!env.GH_PROMPT_DISABLED) env.GH_PROMPT_DISABLED = '1';

    try {
      const output = execFileSync(ghExe, args, {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      }).trim();
      return { tag, url: output };
    } catch (err) {
      const stderr = err.stderr?.trim() || err.message;
      throw new Error(`gh release failed: ${stderr}`);
    }
  }

  if (!token) {
    throw new Error(
      'GitHub CLI (github.com/cli/cli) not found, or PATH points at npm package "gh" (wrong tool). ' +
        'Install: brew install gh, or set GITHUB_CLI to the real gh binary, ' +
        'or set GITHUB_TOKEN and ensure curl is available to publish via the REST API.',
    );
  }

  const url = githubReleaseViaRestApi(tag, title, notesBody, assets, { repo, token });
  return { tag, url };
}

function gitPushTag(remote, tag) {
  git(['push', remote, tag]);
}

function ghAvailable() {
  if (resolveGhExecutable()) return true;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return false;
  try {
    execFileSync('curl', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  gitStatus,
  gitAdd,
  gitAddAll,
  gitCommit,
  gitPush,
  gitPushTag,
  gitDiffStat,
  gitTag,
  gitTagExists,
  generateCommitMessage,
  ghRelease,
  ghAvailable,
};
