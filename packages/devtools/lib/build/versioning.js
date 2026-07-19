'use strict';

const {
  CHROME_MANIFEST,
  FIREFOX_MANIFEST,
  PKG_PATH,
  PLATFORM_DEPENDENCY_EXCLUDE,
  PLATFORM_VERSION_EXCLUDE,
  PROJECT_ROOT,
  fs,
  getVersion,
  path,
} = require('./context');

function collectVersionFiles() {
  const files = [
    { path: PKG_PATH, name: 'package.json' },
    { path: CHROME_MANIFEST, name: 'extensions/chrome/manifest.json', jsonType: 'manifest' },
    { path: FIREFOX_MANIFEST, name: 'extensions/firefox/manifest.json', jsonType: 'manifest' },
    {
      path: path.join(PROJECT_ROOT, 'openclaw-plugin', 'openclaw.plugin.json'),
      name: 'openclaw-plugin/openclaw.plugin.json',
    },
    {
      path: path.join(PROJECT_ROOT, 'openclaw-plugin', 'package.json'),
      name: 'openclaw-plugin/package.json',
    },
    {
      path: path.join(PROJECT_ROOT, 'extensions', 'firefox', 'popup', 'package.json'),
      name: 'extensions/firefox/popup/package.json',
    },
  ];

  for (const workspaceRoot of ['apps', 'packages']) {
    const absRoot = path.join(PROJECT_ROOT, workspaceRoot);
    if (!fs.existsSync(absRoot)) continue;
    for (const entry of fs.readdirSync(absRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (PLATFORM_VERSION_EXCLUDE.has(entry.name)) continue;
      const pkgPath = path.join(absRoot, entry.name, 'package.json');
      if (fs.existsSync(pkgPath)) {
        files.push({ path: pkgPath, name: `${workspaceRoot}/${entry.name}/package.json` });
      }
    }
  }

  return files;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectHeroBadgeFiles() {
  const candidates = [
    'src/index.html',
    'src/i18n/locales/en-US.js',
    'src/i18n/locales/zh-CN.js',
  ];
  return candidates
    .map((rel) => ({ rel, abs: path.join(PROJECT_ROOT, rel) }))
    .filter((f) => fs.existsSync(f.abs));
}

function bumpHeroBadgeVersions(t, oldVersion, newVersion) {
  if (oldVersion === newVersion) return;
  const pattern = new RegExp(`\\bv${escapeRegex(oldVersion)}\\b`, 'g');
  for (const file of collectHeroBadgeFiles()) {
    const before = fs.readFileSync(file.abs, 'utf8');
    const after = before.replace(pattern, `v${newVersion}`);
    if (after === before) continue;
    fs.writeFileSync(file.abs, after, 'utf8');
    const count = (before.match(pattern) || []).length;
    console.log(
      `  ✓ ${t('bump.updated')
        .replace('{name}', `${file.rel} (${count} hero badge${count === 1 ? '' : 's'})`)
        .replace('{old}', `v${oldVersion}`)
        .replace('{new}', `v${newVersion}`)}`
    );
  }
}

function syncInternalDependencyVersions(content, newVersion) {
  const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  for (const field of dependencyFields) {
    if (!content[field] || typeof content[field] !== 'object') continue;
    for (const name of Object.keys(content[field])) {
      if (name.startsWith('@js-eyes/') && !PLATFORM_DEPENDENCY_EXCLUDE.has(name)) {
        content[field][name] = newVersion;
      }
    }
  }
}

function bump(t, newVersion) {
  if (!newVersion) {
    console.error(`  ✗ ${t('bump.noVersion')}`);
    console.log(t('bump.usage'));
    console.log(t('bump.example'));
    process.exit(1);
  }
  if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
    console.error(`  ✗ ${t('bump.badFormat').replace('{version}', newVersion)}`);
    console.log(t('bump.expectedFormat'));
    process.exit(1);
  }

  const current = getVersion();
  console.log('');
  console.log(t('bump.header'));
  console.log('');
  console.log(`  ${t('bump.current').replace('{version}', current)}`);
  console.log(`  ${t('bump.new').replace('{version}', newVersion)}`);
  console.log('');

  const files = collectVersionFiles();

  for (const file of files) {
    if (!fs.existsSync(file.path)) {
      console.error(`  ✗ ${t('bump.fileMissing').replace('{name}', file.name)}`);
      process.exit(1);
    }
    try {
      const content = JSON.parse(fs.readFileSync(file.path, 'utf8'));
      const old = content.version;
      content.version = newVersion;
      syncInternalDependencyVersions(content, newVersion);
      fs.writeFileSync(file.path, JSON.stringify(content, null, 2) + '\n', 'utf8');
      console.log(`  ✓ ${t('bump.updated').replace('{name}', file.name).replace('{old}', old).replace('{new}', newVersion)}`);
    } catch (e) {
      console.error(`  ✗ ${t('bump.updateFailed').replace('{name}', file.name).replace('{msg}', e.message)}`);
      process.exit(1);
    }
  }

  bumpHeroBadgeVersions(t, current, newVersion);

  console.log('');
  console.log(`  ${t('bump.done')}`);
}

module.exports = { bump };
