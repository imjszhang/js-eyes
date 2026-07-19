'use strict';

const {
  CHROME_DIR,
  DIST_DIR,
  EXCLUDE_PATTERNS,
  EXTENSIONS_DIR,
  EXTENSION_SHARED_COPIES,
  FIREFOX_DIR,
  FIREFOX_MANIFEST,
  PROJECT_ROOT,
  SIGNED_DIR,
  ensureDir,
  execFileSync,
  formatSize,
  fs,
  getVersion,
  path,
} = require('./context');

function assertExtensionSharedRuntime(extensionDir) {
  const sharedDir = path.join(EXTENSIONS_DIR, 'shared');
  for (const [sourceName, targetName] of EXTENSION_SHARED_COPIES) {
    const source = fs.readFileSync(path.join(sharedDir, sourceName));
    const targetPath = path.join(extensionDir, targetName);
    if (!fs.existsSync(targetPath) || !source.equals(fs.readFileSync(targetPath))) {
      throw new Error(`${path.relative(PROJECT_ROOT, targetPath)} is stale; run npm run sync:extension-shared`);
    }
  }
}

function loadEnvFile() {
  const envPaths = [
    path.join(PROJECT_ROOT, '.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...rest] = trimmed.split('=');
          if (key && rest.length > 0) {
            process.env[key.trim()] = rest.join('=').replace(/^["']|["']$/g, '').trim();
          }
        }
      }
      return envPath;
    }
  }
  return null;
}

function getApiConfig() {
  const apiKey = process.env.AMO_API_KEY;
  const apiSecret = process.env.AMO_API_SECRET;
  if (apiKey && apiSecret) return { apiKey, apiSecret };
  return null;
}

async function buildChrome(t) {
  console.log('');
  console.log(t('chrome.header'));
  console.log('');

  const version = getVersion();

  if (!fs.existsSync(CHROME_DIR)) {
    console.error(`  ✗ ${t('chrome.dirMissing')}`);
    process.exit(1);
  }
  assertExtensionSharedRuntime(CHROME_DIR);

  ensureDir(DIST_DIR);

  const outputFile = path.join(DIST_DIR, `js-eyes-chrome-v${version}.zip`);

  if (fs.existsSync(outputFile)) {
    fs.unlinkSync(outputFile);
    console.log(`  ${t('chrome.deletedOld')}`);
  }

  const archiver = require('archiver');
  const output = fs.createWriteStream(outputFile);
  const archive = archiver('zip', { zlib: { level: 9 } });

  /** @type {Promise<void>} */
  return new Promise((resolve, reject) => {
    output.on('close', () => {
      const stats = fs.statSync(outputFile);
      console.log(`  ✓ ${t('chrome.done')}`);
      console.log(`  ${t('chrome.output').replace('{path}', outputFile)}`);
      console.log(`  ${t('chrome.size').replace('{size}', formatSize(stats.size))}`);
      resolve();
    });
    archive.on('error', (err) => {
      console.error(`  ✗ ${t('chrome.error').replace('{msg}', err.message)}`);
      reject(err);
    });
    archive.pipe(output);
    archive.glob('**/*', { cwd: CHROME_DIR, dot: false, ignore: EXCLUDE_PATTERNS });
    archive.finalize();
  });
}

function finalizeFirefoxArtifact(t, version) {
  const xpiFiles = fs.existsSync(SIGNED_DIR)
    ? fs.readdirSync(SIGNED_DIR).filter((file) => file.endsWith('.xpi'))
    : [];
  if (xpiFiles.length === 0) {
    console.error(`  ✗ ${t('firefox.signFailed').replace('{msg}', 'No signed XPI artifact found in dist/firefox-signed')}`);
    process.exit(1);
  }

  console.log(`  ${t('firefox.signedFiles')}`);
  xpiFiles.forEach((file) => {
    const stat = fs.statSync(path.join(SIGNED_DIR, file));
    console.log(`    - ${file} (${formatSize(stat.size)})`);
  });

  const preferred = xpiFiles.find((file) => file.includes(`-${version}.xpi`));
  const latest = preferred || xpiFiles.sort().reverse()[0];
  const distName = `js-eyes-firefox-v${version}.xpi`;
  const distPath = path.join(DIST_DIR, distName);
  fs.copyFileSync(path.join(SIGNED_DIR, latest), distPath);
  console.log(`  ${t('firefox.copiedToDist').replace('{file}', distName)}`);
  const stat = fs.statSync(distPath);
  console.log(`  ${t('chrome.output').replace('{path}', distPath)}`);
  console.log(`  ${t('chrome.size').replace('{size}', formatSize(stat.size))}`);
}

async function buildFirefox(t, sign = true) {
  console.log('');
  console.log(t('firefox.header'));
  console.log('');

  const version = getVersion();

  if (!fs.existsSync(FIREFOX_DIR)) {
    console.error(`  ✗ ${t('firefox.dirMissing')}`);
    process.exit(1);
  }
  if (!fs.existsSync(FIREFOX_MANIFEST)) {
    console.error(`  ✗ ${t('firefox.manifestMissing')}`);
    process.exit(1);
  }
  assertExtensionSharedRuntime(FIREFOX_DIR);

  if (!sign) {
    console.log(`  ⚠ ${t('firefox.skipSign')}`);
    console.log(`  ${t('firefox.skipNote')}`);
    return;
  }

  const envPath = loadEnvFile();
  if (envPath) console.log(`  ${t('env.foundFile').replace('{path}', envPath)}`);

  console.log(`  ${t('firefox.checkPrereqs')}`);
  try {
    execFileSync('web-ext', ['--version'], { stdio: 'pipe' });
    console.log(`  ✓ ${t('firefox.webextOk')}`);
  } catch {
    console.error(`  ✗ ${t('firefox.webextMissing')}`);
    console.log(`  ${t('firefox.webextInstall')}`);
    process.exit(1);
  }

  const apiCfg = getApiConfig();
  if (!apiCfg) {
    console.error(`  ✗ ${t('env.notFound')}`);
    console.log('');
    console.log(t('env.configHelp'));
    console.log('');
    console.log(t('env.optEnv'));
    console.log('  set AMO_API_KEY=your-api-key');
    console.log('  set AMO_API_SECRET=your-api-secret');
    console.log('');
    console.log(t('env.amoUrl'));
    process.exit(1);
  }
  console.log(`  ✓ ${t('env.fromEnv')}`);

  ensureDir(SIGNED_DIR);
  ensureDir(DIST_DIR);

  const existingSignedForVersion = fs.readdirSync(SIGNED_DIR)
    .filter((file) => file.endsWith('.xpi'))
    .filter((file) => file.includes(`-${version}.xpi`));
  if (existingSignedForVersion.length > 0) {
    console.log(`  ⚠ Reusing existing signed Firefox artifact for ${version}`);
    finalizeFirefoxArtifact(t, version);
    return;
  }

  console.log(`  ${t('firefox.signing')}`);
  try {
    const args = [
      'sign',
      `--api-key=${apiCfg.apiKey}`,
      `--api-secret=${apiCfg.apiSecret}`,
      `--artifacts-dir=${SIGNED_DIR}`,
      '--channel=unlisted',
    ];
    console.log(`  ${t('firefox.execCmd').replace('{cmd}', 'web-ext sign --api-key=*** --api-secret=*** --channel=unlisted')}`);

    execFileSync('web-ext', args, { cwd: FIREFOX_DIR, stdio: 'inherit' });
    console.log(`  ✓ ${t('firefox.signOk')}`);
    finalizeFirefoxArtifact(t, version);
  } catch (e) {
    const message = e && e.stderr ? String(e.stderr) : '';
    if (message.includes('This upload has already been submitted.')) {
      console.log(`  ⚠ Firefox ${version} has already been submitted to AMO, reusing the existing signed artifact`);
      finalizeFirefoxArtifact(t, version);
      return;
    }
    const exitCode = e && typeof e.status === 'number' ? `exit code ${e.status}` : 'web-ext failed';
    console.error(`  ✗ ${t('firefox.signFailed').replace('{msg}', exitCode)}`);
    process.exit(1);
  }
}

module.exports = { buildChrome, buildFirefox };
