'use strict';

const {
  DIST_DIR,
  INSTALL_SCRIPTS,
  PROJECT_ROOT,
  SITE_OUT_DIR,
  SKILL_ZIP_NAME,
  SRC_DIR,
  copyDirSync,
  ensureDir,
  fs,
  getVersion,
  path,
} = require('./context');
const { buildSkillZip } = require('./skill-bundle');
const { buildSkillsRegistry, buildSubSkillZips } = require('./skills-registry');

function pruneUnavailableExtensionDownloads(assetStates) {
  const siteIndex = path.join(SITE_OUT_DIR, 'index.html');
  if (!fs.existsSync(siteIndex)) return;

  let html = fs.readFileSync(siteIndex, 'utf8');

  for (const asset of assetStates) {
    if (asset.exists) continue;
    if (asset.preserveWhenMissing) {
      console.log(`  ⚠ ${asset.dest} missing from dist/, keeping ${asset.label} download button`);
      continue;
    }
    const linkPattern = new RegExp(`\\s*<a id="${asset.linkId}"[\\s\\S]*?<\\/a>\\s*`, 'm');
    html = html.replace(linkPattern, '\n');
    console.log(`  ⚠ ${asset.dest} missing from dist/, hiding ${asset.label} download button`);
  }

  if (assetStates.every((asset) => !asset.exists && !asset.preserveWhenMissing)) {
    html = html.replace(/\s*<div id="extension-download-links"[\s\S]*?<\/div>\s*/m, '\n');
    console.log('  ⚠ No extension artifacts found in dist/, hiding site download buttons');
  }

  fs.writeFileSync(siteIndex, html, 'utf8');
}

function cleanSiteOutput() {
  if (!fs.existsSync(SITE_OUT_DIR)) return;

  const generatedEntries = new Set([
    '.nojekyll',
    'skills',
    'skills.json',
    SKILL_ZIP_NAME,
    `${SKILL_ZIP_NAME}.sha256`,
    'js-eyes-chrome-latest.zip',
    'js-eyes-firefox-latest.xpi',
    ...INSTALL_SCRIPTS,
  ]);

  if (fs.existsSync(SRC_DIR)) {
    for (const entry of fs.readdirSync(SRC_DIR)) {
      generatedEntries.add(entry);
    }
  }

  for (const entry of generatedEntries) {
    const fullPath = path.join(SITE_OUT_DIR, entry);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }
}

async function buildSite(t, options = {}) {
  const { clean = false } = options;

  console.log('');
  console.log(t('site.header'));
  console.log('');

  if (!fs.existsSync(SRC_DIR)) {
    console.error(`  ✗ ${t('site.srcMissing')}`);
    process.exit(1);
  }

  if (clean) {
    cleanSiteOutput();
    console.log(`  ${t('site.cleaned')}`);
  }

  ensureDir(SITE_OUT_DIR);
  copyDirSync(SRC_DIR, SITE_OUT_DIR);
  console.log(`  ✓ ${t('site.copied')}`);

  const nojekyll = path.join(SITE_OUT_DIR, '.nojekyll');
  if (!fs.existsSync(nojekyll)) {
    fs.writeFileSync(nojekyll, '');
  }
  console.log(`  ✓ ${t('site.nojekyll')}`);

  for (const script of INSTALL_SCRIPTS) {
    const src = path.join(PROJECT_ROOT, script);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(SITE_OUT_DIR, script));
    }
  }
  console.log('  ✓ Install scripts copied to dist/');

  const version = getVersion();
  const extensionAssets = [
    {
      src: path.join(DIST_DIR, `js-eyes-chrome-v${version}.zip`),
      dest: 'js-eyes-chrome-latest.zip',
      linkId: 'download-chrome-link',
      label: 'Chrome',
      preserveWhenMissing: true,
    },
    {
      src: path.join(DIST_DIR, `js-eyes-firefox-v${version}.xpi`),
      dest: 'js-eyes-firefox-latest.xpi',
      linkId: 'download-firefox-link',
      label: 'Firefox',
      preserveWhenMissing: true,
    },
  ];
  for (const asset of extensionAssets) {
    const siteAssetPath = path.join(SITE_OUT_DIR, asset.dest);
    asset.exists = fs.existsSync(asset.src);
    if (asset.exists) {
      fs.copyFileSync(asset.src, siteAssetPath);
      console.log(`  ✓ ${asset.dest} (from dist/)`);
    } else if (fs.existsSync(siteAssetPath)) {
      fs.unlinkSync(siteAssetPath);
    }
  }
  pruneUnavailableExtensionDownloads(extensionAssets);

  await buildSkillZip();
  const subSkillResults = await buildSubSkillZips();
  await buildSkillsRegistry(subSkillResults);

  console.log(`  ✓ ${t('site.done')}`);
}

module.exports = { buildSite };
