#!/usr/bin/env node

/**
 * JS Eyes Devtools CLI
 *
 * 仅供仓库维护者使用，不作为 npm 用户 CLI 发布入口。
 */

const i18n = require('../i18n');
const {
  buildSite,
  buildSkillZip,
  bump,
  getVersion,
} = require('../lib/builder');
const {
  gitStatus,
  gitAddAll,
  gitCommit,
  gitPushTag,
  gitDiffStat,
  gitTag,
  gitTagExists,
  generateCommitMessage,
  ghRelease,
  ghAvailable,
} = require('../lib/git');
const { setupGitHubPages } = require('../lib/github-pages');
const { setupCloudflare } = require('../lib/cloudflare');
const { bundle: bundlePublish, DIST_ROOT } = require('../lib/publish-bundle');
const npmPublish = require('../lib/npm-publish');
const dotenv = require('../lib/dotenv');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
dotenv.load(REPO_ROOT);

i18n.init(process.argv.slice(2));
const t = i18n.t;

function parseArgs(argv) {
  const raw = argv.slice(2);
  const args = raw.filter((arg) => arg !== '--lang' && !i18n.SUPPORTED.includes(arg));
  const command = args[0] || '';
  const sub = args[1] || '';
  const flags = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }

  return { command, sub, flags };
}

function log(message) {
  console.error(message);
}

async function cmdBuild(sub, flags) {
  const clean = !!flags.clean;
  const target = sub || 'all';

  switch (target) {
    case 'skill':
      await buildSkillZip();
      break;
    case 'site':
    case 'all':
      await buildSite(t, { clean });
      break;
    default:
      console.error(t('help.unknownTarget').replace('{target}', target));
      process.exit(1);
  }
}

function cmdCommit(flags) {
  try {
    const status = gitStatus();
    if (status.clean) {
      log(t('git.clean'));
      return;
    }

    log(t('git.staging'));
    gitAddAll();

    const { files } = gitDiffStat();
    if (files.length === 0) {
      log(t('git.nothingStaged'));
      return;
    }

    const message = flags.message || flags.m || generateCommitMessage(files);
    log(`${t('git.committing')} ${message}`);
    const { hash } = gitCommit(message);

    log(`${t('git.committed')} ${hash}`);
    log(`  ${t('git.branch')}: ${status.branch}`);
    log(`  ${t('git.files')}: ${files.length}`);
  } catch (error) {
    log(`  ✗ ${error.message}`);
    process.exit(1);
  }
}

async function cmdSync(flags) {
  try {
    const noBuild = !!flags['no-build'];

    const status = gitStatus();
    log(`${t('git.branch')}: ${status.branch}`);

    if (!noBuild) {
      log('');
      log(`── ${t('git.stepBuild')} ──`);
      await buildSite(t, { clean: true });
    } else {
      log(t('git.buildSkipped'));
    }

    log(t('site.done'));
  } catch (error) {
    log(`  ✗ ${error.message}`);
    process.exit(1);
  }
}

async function cmdSetupGitHubPages(flags) {
  try {
    const domain = flags.domain || flags.d;
    const repo = flags.repo || flags.r;
    await setupGitHubPages(domain, repo, t);
  } catch (error) {
    log(`  ✗ ${error.message}`);
    process.exit(1);
  }
}

async function cmdSetupCloudflare(flags) {
  try {
    const domain = flags.domain || flags.d;
    const target = flags.target || flags.t;
    await setupCloudflare(domain, target, t);
  } catch (error) {
    log(`  ✗ ${error.message}`);
    process.exit(1);
  }
}

function getVersionSection(version) {
  const file = path.join(REPO_ROOT, 'RELEASE_NOTES.md');
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const start = lines.indexOf(`## v${version}`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## v\d/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

function extractReleaseNotes(version) {
  const section = getVersionSection(version);
  if (!section) return null;
  return section.join('\n').trimEnd() + '\n';
}

function writeTempFile(prefix, content) {
  const os = require('os');
  const filePath = path.join(os.tmpdir(), `${prefix}-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function cmdBundle() {
  try {
    await bundlePublish();
  } catch (error) {
    log(`  ✗ ${error.message}`);
    process.exit(1);
  }
}

const { RELEASE_PACKAGES: WORKSPACE_PUBLISH_ORDER } = require('../../../scripts/release-packages');

async function cmdPublish(sub, flags) {
  if (sub !== 'workspaces') {
    log(`unknown publish target: ${sub || '(none)'}`);
    log('usage: js-eyes-dev publish workspaces [--dry-run]');
    process.exit(1);
  }

  const dryRun = !!flags['dry-run'];
  const pkgs = WORKSPACE_PUBLISH_ORDER;
  const total = pkgs.length;

  log(`── publish workspaces ──`);
  if (dryRun) log('  (dry-run mode — npm publish --dry-run)');

  const who = npmPublish.whoami();
  if (who) log(`  as: ${who}`);
  else log('  ⚠ could not resolve npm whoami (NPM_TOKEN missing or invalid)');

  let published = 0;
  let skipped = 0;

  for (let i = 0; i < total; i++) {
    const { name, dir } = pkgs[i];
    const pkgDir = path.join(REPO_ROOT, dir);
    const manifest = require(path.join(pkgDir, 'package.json'));
    const version = manifest.version;
    const header = `[${i + 1}/${total}] ${name}@${version}`;

    if (!dryRun && npmPublish.versionExists(name, version)) {
      log(`${header} — already on registry, skipping`);
      skipped++;
      continue;
    }

    log(header);
    try {
      const { stdout } = npmPublish.publishFromSource(pkgDir, { dryRun });
      const notice = (stdout || '')
        .split('\n')
        .filter((line) => /\+\s+@js-eyes\//.test(line) || /npm notice total files/.test(line))
        .join(' ')
        .trim();
      if (notice) log(`  ${notice}`);
      log(dryRun ? `  ✓ dry-run ok` : `  ✓ published`);
      published++;
    } catch (error) {
      log(`  ✗ ${error.message}`);
      process.exit(1);
    }
  }

  log('');
  log(`✓ publish workspaces complete (published: ${published}, skipped: ${skipped}, dry-run: ${dryRun})`);
}

async function cmdRelease(flags) {
  const skipBundle = !!flags['skip-bundle'];
  const skipExtensions = !!flags['skip-extensions'];
  const skipNpm = !!flags['skip-npm'];
  const skipGithub = !!flags['skip-github'];
  const skipTag = !!flags['skip-tag'];
  const dryRun = !!flags['dry-run'];

  const version = getVersion();
  const tag = `v${version}`;
  const repo = flags.repo || 'imjszhang/js-eyes';

  log(`── release ${tag} ──`);
  if (dryRun) log('  (dry-run mode — no side effects)');

  // Preflight: fail fast if RELEASE_NOTES.md is missing the version section,
  // so we don't ship a "generic fallback" GitHub release body half-way through.
  if (!skipGithub && !extractReleaseNotes(version)) {
    log(`  ✗ RELEASE_NOTES.md is missing "## v${version}" section`);
    log('    add it before running release, or pass --skip-github');
    process.exit(1);
  }

  const status = gitStatus();
  if (!status.clean) {
    log(`  ⚠ working tree not clean on branch ${status.branch}`);
    log(`    staged=${status.staged.length} unstaged=${status.unstaged.length} untracked=${status.untracked.length}`);
  }

  try {
    // [1/6] bundle
    if (!skipBundle) {
      log('');
      log('[1/6] bundle');
      const { distDir } = await bundlePublish();
      log(`  ✓ bundled → ${path.relative(REPO_ROOT, distDir)}`);
    } else {
      log('[1/6] bundle — skipped');
    }

    // [2/5] skill bundle (browser extensions live in imjszhang/js-eyes-extension)
    if (!skipExtensions) {
      log('');
      log('[2/5] skill bundle');
      const skillZip = path.join(REPO_ROOT, 'dist', `js-eyes-skill-v${version}.zip`);

      if (fs.existsSync(skillZip)) {
        log(`  ✓ skill already built (${path.relative(REPO_ROOT, skillZip)})`);
      } else if (dryRun) {
        log('  (would build skill bundle)');
      } else {
        await buildSkillZip();
      }
    } else {
      log('[2/5] skill bundle — skipped');
    }

    // [3/6] npm publish
    if (!skipNpm) {
      log('');
      log('[3/6] npm publish');
      const who = npmPublish.whoami();
      if (who) log(`  as: ${who}`);
      if (dryRun) {
        log(`  (would publish js-eyes@${version} from ${path.relative(REPO_ROOT, DIST_ROOT)})`);
      } else {
        npmPublish.publish(DIST_ROOT);
        log(`  ✓ published js-eyes@${version}`);
      }
    } else {
      log('[3/6] npm publish — skipped');
    }

    // [4/6] git tag + push
    if (!skipTag) {
      log('');
      log('[4/6] git tag');
      if (gitTagExists(tag)) {
        log(`  ⚠ tag ${tag} already exists locally, skipping tag creation`);
      } else if (dryRun) {
        log(`  (would create tag ${tag})`);
      } else {
        gitTag(tag, `Release ${tag}`);
        log(`  ✓ created tag ${tag}`);
      }
      if (!dryRun) {
        try {
          gitPushTag('origin', tag);
          log(`  ✓ pushed ${tag} → origin`);
        } catch (err) {
          if (/already exists|rejected/i.test(err.message)) {
            log(`  ⚠ remote already has ${tag}, continuing`);
          } else {
            throw err;
          }
        }
      }
    } else {
      log('[4/6] git tag — skipped');
    }

    // [5/6] GitHub release
    if (!skipGithub) {
      log('');
      log('[5/6] github release');
      if (!ghAvailable()) {
        log(`  ✗ ${t('release.ghMissing') || 'gh CLI not found'}`);
        log('  (install: brew install gh)');
        process.exit(1);
      }

      const assets = [];
      const distRoot = path.join(REPO_ROOT, 'dist');
      if (fs.existsSync(distRoot)) {
        const files = fs.readdirSync(distRoot).filter((f) => f.includes(version) && /\.(zip|xpi|tgz)$/.test(f));
        for (const f of files) assets.push(path.join(distRoot, f));
      }
      if (assets.length) {
        log('  assets:');
        assets.forEach((a) => log(`    - ${path.basename(a)}`));
      } else {
        log('  (no assets matched — release will be notes-only)');
      }

      const notes = extractReleaseNotes(version);
      const title = flags.title || `JS Eyes ${tag}`;
      let notesFile = null;
      if (notes) {
        notesFile = writeTempFile('js-eyes-release', notes);
        log(`  notes: RELEASE_NOTES.md § v${version} (${notes.length} bytes)`);
      } else {
        log('  notes: (generic fallback)');
      }

      if (dryRun) {
        log(`  (would create release ${tag} on ${repo})`);
      } else {
        try {
          const { url } = ghRelease(tag, title, notes, assets, { repo, notesFile });
          log(`  ✓ ${url}`);
        } finally {
          if (notesFile) {
            try { fs.unlinkSync(notesFile); } catch { /* ignore */ }
          }
        }
      }
    } else {
      log('[5/5] github release — skipped');
    }

    log('');
    log(`✓ release ${tag} complete`);
  } catch (error) {
    log(`  ✗ ${error.message}`);
    process.exit(1);
  }
}

function showHelp() {
  console.log(t('tool.name'));
  console.log('');
  console.log(t('help.usage'));
  console.log('');
  console.log(t('help.commands'));
  console.log(t('help.cmdBuildSkill'));
  console.log(t('help.cmdBuildSite'));
  console.log(t('help.cmdBuildChrome'));
  console.log(t('help.cmdBuildFirefox'));
  console.log(t('help.cmdBuildAll'));
  console.log(t('help.cmdBump'));
  console.log(t('help.cmdCommit'));
  console.log(t('help.cmdSync'));
  console.log(t('help.cmdRelease'));
  console.log(t('help.cmdPublishWs'));
  console.log(t('help.cmdSetupGhPages'));
  console.log(t('help.cmdSetupCloudflare'));
  console.log('');
  console.log(t('help.options'));
  console.log(t('help.optNoSign'));
  console.log(t('help.optClean'));
  console.log(t('help.optMessage'));
  console.log(t('help.optNoBuild'));
  console.log(t('help.optNoPush'));
  console.log(t('help.optDraft'));
  console.log(t('help.optLang'));
  console.log(t('help.optDomain'));
  console.log(t('help.optRepo'));
  console.log(t('help.optTarget'));
}

async function main() {
  const { command, sub, flags } = parseArgs(process.argv);

  switch (command) {
    case 'build':
      await cmdBuild(sub, flags);
      break;
    case 'bump':
      bump(t, sub);
      break;
    case 'commit':
      cmdCommit(flags);
      break;
    case 'sync':
      await cmdSync(flags);
      break;
    case 'release':
      await cmdRelease(flags);
      break;
    case 'bundle':
      await cmdBundle();
      break;
    case 'publish':
      await cmdPublish(sub, flags);
      break;
    case 'setup-github-pages':
    case 'setup-gh-pages':
      await cmdSetupGitHubPages(flags);
      break;
    case 'setup-cloudflare':
    case 'setup-cf':
      await cmdSetupCloudflare(flags);
      break;
    case '--help':
    case '-h':
    case 'help':
      showHelp();
      break;
    default:
      if (command) {
        console.error(t('help.unknownCmd').replace('{cmd}', command));
        console.log('');
      }
      showHelp();
      process.exit(command ? 1 : 0);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(t('help.buildError').replace('{msg}', error.message));
    process.exit(1);
  });
}

module.exports = { main };
