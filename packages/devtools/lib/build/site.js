'use strict';

const {
  INSTALL_SCRIPTS,
  PROJECT_ROOT,
  SITE_OUT_DIR,
  SKILL_ZIP_NAME,
  SRC_DIR,
  copyDirSync,
  ensureDir,
  fs,
  path,
} = require('./context');
const { buildSkillZip } = require('./skill-bundle');
const { buildSkillsRegistry, buildSubSkillZips } = require('./skills-registry');

function cleanSiteOutput() {
  if (!fs.existsSync(SITE_OUT_DIR)) return;

  const generatedEntries = new Set([
    '.nojekyll',
    'skills',
    'skills.json',
    SKILL_ZIP_NAME,
    `${SKILL_ZIP_NAME}.sha256`,
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

  await buildSkillZip();
  const subSkillResults = await buildSubSkillZips();
  await buildSkillsRegistry(subSkillResults);

  console.log(`  ✓ ${t('site.done')}`);
}

module.exports = { buildSite };
