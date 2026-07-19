'use strict';

const {
  BUNDLE_RUNTIME_PACKAGES,
  DIST_DIR,
  MAIN_SKILL_DIST_ASSET,
  MAIN_SKILL_STAGE_DIR,
  PROJECT_ROOT,
  SITE_OUT_DIR,
  SKILL_BUNDLE_FILES,
  SKILL_ZIP_NAME,
  copyDirSync,
  ensureDir,
  formatSize,
  fs,
  getVersion,
  hashFile,
  path,
  writeFile,
  writeShaSidecar,
} = require('./context');

function createBundlePackageJson(version) {
  return {
    name: 'js-eyes-skill-bundle',
    version,
    private: true,
    description: 'Installable JS Eyes skill bundle for OpenClaw',
    workspaces: ['packages/*'],
    dependencies: {
      '@js-eyes/client-sdk': version,
      '@js-eyes/protocol': version,
      '@js-eyes/server-core': version,
    },
    engines: {
      node: '>=22.0.0',
    },
    license: 'MIT',
  };
}

function createCompatServerPackageJson(version) {
  return {
    name: 'js-eyes-server-compat',
    version,
    private: true,
    main: 'index.js',
    license: 'MIT',
  };
}

function stageRuntimePackages(stageDir) {
  const packagesDir = path.join(stageDir, 'packages');
  ensureDir(packagesDir);

  for (const pkgName of BUNDLE_RUNTIME_PACKAGES) {
    const src = path.join(PROJECT_ROOT, 'packages', pkgName);
    const dest = path.join(packagesDir, pkgName);
    if (!fs.existsSync(src)) {
      throw new Error(`Bundle runtime package missing: packages/${pkgName}`);
    }
    copyDirSync(src, dest);
  }
}

function stageOpenClawPlugin(stageDir) {
  const src = path.join(PROJECT_ROOT, 'openclaw-plugin');
  const dest = path.join(stageDir, 'openclaw-plugin');
  if (!fs.existsSync(src)) {
    throw new Error('Bundle OpenClaw plugin missing: openclaw-plugin');
  }
  copyDirSync(src, dest);
}

function stageCompatWrappers(stageDir, version) {
  const compatServerDir = path.join(stageDir, 'server');
  ensureDir(compatServerDir);
  writeFile(path.join(compatServerDir, 'index.js'), "'use strict';\n\nmodule.exports = require('../packages/server-core');\n");
  writeFile(path.join(compatServerDir, 'ws-handler.js'), "'use strict';\n\nmodule.exports = require('../packages/server-core/ws-handler.js');\n");
  writeFile(
    path.join(compatServerDir, 'package.json'),
    JSON.stringify(createCompatServerPackageJson(version), null, 2) + '\n',
  );

  const compatClientDir = path.join(stageDir, 'clients');
  ensureDir(compatClientDir);
  writeFile(path.join(compatClientDir, 'js-eyes-client.js'), "'use strict';\n\nmodule.exports = require('../packages/client-sdk');\n");
}

function prepareMainSkillBundleStage() {
  const version = getVersion();

  fs.rmSync(MAIN_SKILL_STAGE_DIR, { recursive: true, force: true });
  ensureDir(MAIN_SKILL_STAGE_DIR);

  for (const file of SKILL_BUNDLE_FILES) {
    const src = path.join(PROJECT_ROOT, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(MAIN_SKILL_STAGE_DIR, file));
    }
  }

  writeFile(
    path.join(MAIN_SKILL_STAGE_DIR, 'package.json'),
    JSON.stringify(createBundlePackageJson(version), null, 2) + '\n',
  );

  stageRuntimePackages(MAIN_SKILL_STAGE_DIR);
  stageOpenClawPlugin(MAIN_SKILL_STAGE_DIR);
  stageCompatWrappers(MAIN_SKILL_STAGE_DIR, version);

  return { version, stageDir: MAIN_SKILL_STAGE_DIR };
}

async function buildSkillZip() {
  const archiver = require('archiver');
  const { version, stageDir } = prepareMainSkillBundleStage();
  const outputFile = path.join(SITE_OUT_DIR, SKILL_ZIP_NAME);
  const distAsset = MAIN_SKILL_DIST_ASSET(version);

  if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
  ensureDir(DIST_DIR);
  if (fs.existsSync(distAsset)) fs.unlinkSync(distAsset);

  const output = fs.createWriteStream(outputFile);
  const archive = archiver('zip', { zlib: { level: 9 } });

  /** @type {Promise<void>} */
  const archiveComplete = new Promise((resolve, reject) => {
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);

    archive.directory(stageDir, false);
    archive.finalize();
  });
  await archiveComplete;

  const stats = fs.statSync(outputFile);
  const { sha256 } = hashFile(outputFile);
  writeShaSidecar(outputFile, sha256);
  fs.copyFileSync(outputFile, distAsset);
  writeShaSidecar(distAsset, sha256);
  console.log(`  ✓ Skill bundle: ${SKILL_ZIP_NAME} (${formatSize(stats.size)}, sha256 ${sha256.slice(0, 12)}…)`);
  console.log(`  ✓ Skill bundle asset: ${path.basename(distAsset)}`);
}

module.exports = { buildSkillZip, prepareMainSkillBundleStage };
