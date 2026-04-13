'use strict';

/**
 * JS Eyes Builder
 *
 * Site build:  src/ → docs/
 * Chrome:      package extensions/chrome/ into ZIP
 * Firefox:     package & sign extensions/firefox/
 * Bump:        sync version across manifests
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const DOCS_DIR = path.join(PROJECT_ROOT, 'docs');
const EXTENSIONS_DIR = path.join(PROJECT_ROOT, 'extensions');
const CHROME_DIR = path.join(EXTENSIONS_DIR, 'chrome');
const FIREFOX_DIR = path.join(EXTENSIONS_DIR, 'firefox');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const SIGNED_DIR = path.join(DIST_DIR, 'firefox-signed');
const PKG_PATH = path.join(PROJECT_ROOT, 'package.json');
const CHROME_MANIFEST = path.join(CHROME_DIR, 'manifest.json');
const FIREFOX_MANIFEST = path.join(FIREFOX_DIR, 'manifest.json');

const EXCLUDE_PATTERNS = [
  '.git/**', '**/.git/**', '**/.DS_Store', '**/Thumbs.db',
  '**/*.swp', '**/*.swo', '.amo-upload-uuid', 'node_modules/**',
];

function getVersion() {
  try {
    return JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function copyDirSync(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function pruneUnavailableExtensionDownloads(assetStates) {
  const docsIndex = path.join(DOCS_DIR, 'index.html');
  if (!fs.existsSync(docsIndex)) return;

  let html = fs.readFileSync(docsIndex, 'utf8');

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

  fs.writeFileSync(docsIndex, html, 'utf8');
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

const SKILL_BUNDLE_FILES = ['SKILL.md', 'SECURITY.md', 'LICENSE'];
const SKILL_ZIP_NAME = 'js-eyes-skill.zip';
const SKILL_BUNDLE_STAGE_ROOT = path.join(DIST_DIR, 'skill-bundle');
const MAIN_SKILL_STAGE_DIR = path.join(SKILL_BUNDLE_STAGE_ROOT, 'js-eyes');
const MAIN_SKILL_DIST_ASSET = (version) => path.join(DIST_DIR, `js-eyes-skill-v${version}.zip`);
const INSTALL_SCRIPTS = ['install.sh', 'install.ps1'];
const BUNDLE_RUNTIME_PACKAGES = ['client-sdk', 'protocol', 'server-core'];

const SKILLS_DIR = path.join(PROJECT_ROOT, 'skills');
const SITE_URL = 'https://js-eyes.com';

const SUB_SKILL_EXCLUDE = [
  'node_modules/**', '**/node_modules/**', 'work_dir/**', '**/work_dir/**',
  'package-lock.json', '.git/**', '**/.git/**', '**/.DS_Store', '**/Thumbs.db',
];

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

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
      node: '>=16.0.0',
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

function parseSkillFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const lines = match[1].split(/\r?\n/);
  const root = {};
  const stack = [{ obj: root, indent: -1 }];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;

    const indent = raw.search(/\S/);
    const trimmed = raw.trim();

    while (stack.length > 1 && indent < stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    if (trimmed.startsWith('- ')) {
      const val = parseYamlValue(trimmed.slice(2).trim());
      if (Array.isArray(parent)) parent.push(val);
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const valPart = trimmed.slice(colonIdx + 1).trim();

    if (valPart === '') {
      let nextLine = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) {
          nextLine = lines[j];
          break;
        }
      }
      const nextTrimmed = nextLine.trim();
      const nextIndent = nextLine.search(/\S/);
      if (nextTrimmed.startsWith('- ')) {
        parent[key] = [];
        stack.push({ obj: parent[key], indent: nextIndent >= 0 ? nextIndent : indent + 2 });
      } else {
        parent[key] = {};
        stack.push({ obj: parent[key], indent: nextIndent >= 0 ? nextIndent : indent + 2 });
      }
    } else {
      parent[key] = parseYamlValue(valPart);
    }
  }

  return root;
}

function parseYamlValue(str) {
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'null') return null;
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);

  let val = str;
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  val = val.replace(/\\U([0-9A-Fa-f]{8})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  val = val.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  return val;
}

function loadSkillContract(skillDir) {
  const contractPath = path.join(skillDir, 'skill.contract.js');
  if (!fs.existsSync(contractPath)) return null;
  delete require.cache[require.resolve(contractPath)];
  return require(contractPath);
}

function discoverSubSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(SKILLS_DIR, entry.name);
    const skillMd = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    const meta = parseSkillFrontmatter(skillMd);
    if (!meta || !meta.name) continue;
    const contract = loadSkillContract(skillDir);

    const pluginJson = path.join(skillDir, 'openclaw-plugin', 'openclaw.plugin.json');
    let pluginMeta = null;
    if (fs.existsSync(pluginJson)) {
      try { pluginMeta = JSON.parse(fs.readFileSync(pluginJson, 'utf8')); } catch {}
    }

    const pluginEntry = path.join(skillDir, 'openclaw-plugin', 'index.mjs');
    const tools = Array.isArray(contract?.openclaw?.tools)
      ? contract.openclaw.tools.map((tool) => tool.name)
      : [];
    if (tools.length === 0 && fs.existsSync(pluginEntry)) {
      const src = fs.readFileSync(pluginEntry, 'utf8');
      const re = /name:\s*["']([a-z_]+)["']/g;
      let match;
      while ((match = re.exec(src)) !== null) tools.push(match[1]);
    }
    const commands = Array.isArray(contract?.cli?.commands)
      ? contract.cli.commands.map((command) => command.name)
      : [];

    const oc = (meta.metadata && meta.metadata.openclaw) || {};
    skills.push({
      id: meta.name,
      dir: skillDir,
      dirName: entry.name,
      name: (pluginMeta && pluginMeta.name) || meta.name,
      description: meta.description || '',
      version: meta.version || '1.0.0',
      emoji: oc.emoji || '',
      homepage: oc.homepage || '',
      requires: oc.requires || {},
      tools,
      commands,
      runtime: contract?.runtime || {},
    });
  }
  return skills;
}

async function buildSubSkillZips() {
  const skills = discoverSubSkills();
  if (skills.length === 0) return;

  const archiver = require('archiver');

  for (const skill of skills) {
    const outDir = path.join(DOCS_DIR, 'skills', skill.dirName);
    ensureDir(outDir);

    const zipName = `${skill.id}-skill.zip`;
    const outputFile = path.join(outDir, zipName);
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

    const output = fs.createWriteStream(outputFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.glob('**/*', {
        cwd: skill.dir,
        dot: false,
        ignore: SUB_SKILL_EXCLUDE,
      });
      archive.finalize();
    });

    const stats = fs.statSync(outputFile);
    console.log(`  ✓ Sub-skill bundle: skills/${skill.dirName}/${zipName} (${formatSize(stats.size)})`);
  }
}

async function buildSkillsRegistry() {
  const skills = discoverSubSkills();
  const version = getVersion();

  const registry = {
    version: 1,
    generated: new Date().toISOString(),
    baseUrl: SITE_URL,
    parentSkill: { id: 'js-eyes', version },
    skills: skills.map((skill) => {
      const primary = `${SITE_URL}/skills/${skill.dirName}/${skill.id}-skill.zip`;
      const fallback = `https://cdn.jsdelivr.net/gh/imjszhang/js-eyes@main/docs/skills/${skill.dirName}/${skill.id}-skill.zip`;
      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        emoji: skill.emoji,
        requires: skill.requires,
        downloadUrl: primary,
        downloadUrlFallback: fallback,
        homepage: skill.homepage,
        tools: skill.tools,
        commands: skill.commands,
        runtime: skill.runtime,
      };
    }),
  };

  const outputFile = path.join(DOCS_DIR, 'skills.json');
  fs.writeFileSync(outputFile, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  console.log(`  ✓ Skills registry: skills.json (${skills.length} skill(s))`);
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

  if (clean && fs.existsSync(DOCS_DIR)) {
    const keep = ['README_CN.md', 'CNAME'];
    const entries = fs.readdirSync(DOCS_DIR);
    for (const entry of entries) {
      if (keep.includes(entry)) continue;
      const fullPath = path.join(DOCS_DIR, entry);
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
    console.log(`  ${t('site.cleaned')}`);
  }

  ensureDir(DOCS_DIR);
  copyDirSync(SRC_DIR, DOCS_DIR);
  console.log(`  ✓ ${t('site.copied')}`);

  const nojekyll = path.join(DOCS_DIR, '.nojekyll');
  if (!fs.existsSync(nojekyll)) {
    fs.writeFileSync(nojekyll, '');
  }
  console.log(`  ✓ ${t('site.nojekyll')}`);

  for (const script of INSTALL_SCRIPTS) {
    const src = path.join(PROJECT_ROOT, script);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(DOCS_DIR, script));
    }
  }
  console.log('  ✓ Install scripts copied to docs/');

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
    const docsAssetPath = path.join(DOCS_DIR, asset.dest);
    asset.exists = fs.existsSync(asset.src);
    if (asset.exists) {
      fs.copyFileSync(asset.src, docsAssetPath);
      console.log(`  ✓ ${asset.dest} (from dist/)`);
    } else if (fs.existsSync(docsAssetPath)) {
      fs.unlinkSync(docsAssetPath);
    }
  }
  pruneUnavailableExtensionDownloads(extensionAssets);

  await buildSkillZip();
  await buildSubSkillZips();
  await buildSkillsRegistry();

  console.log(`  ✓ ${t('site.done')}`);
}

async function buildSkillZip() {
  const archiver = require('archiver');
  const { version, stageDir } = prepareMainSkillBundleStage();
  const outputFile = path.join(DOCS_DIR, SKILL_ZIP_NAME);
  const distAsset = MAIN_SKILL_DIST_ASSET(version);

  if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
  ensureDir(DIST_DIR);
  if (fs.existsSync(distAsset)) fs.unlinkSync(distAsset);

  const output = fs.createWriteStream(outputFile);
  const archive = archiver('zip', { zlib: { level: 9 } });

  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    archive.directory(stageDir, false);
    archive.finalize();
  });

  const stats = fs.statSync(outputFile);
  fs.copyFileSync(outputFile, distAsset);
  console.log(`  ✓ Skill bundle: ${SKILL_ZIP_NAME} (${formatSize(stats.size)})`);
  console.log(`  ✓ Skill bundle asset: ${path.basename(distAsset)}`);
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

  ensureDir(DIST_DIR);

  const outputFile = path.join(DIST_DIR, `js-eyes-chrome-v${version}.zip`);

  if (fs.existsSync(outputFile)) {
    fs.unlinkSync(outputFile);
    console.log(`  ${t('chrome.deletedOld')}`);
  }

  const archiver = require('archiver');
  const output = fs.createWriteStream(outputFile);
  const archive = archiver('zip', { zlib: { level: 9 } });

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

  if (!sign) {
    console.log(`  ⚠ ${t('firefox.skipSign')}`);
    console.log(`  ${t('firefox.skipNote')}`);
    return;
  }

  const envPath = loadEnvFile();
  if (envPath) console.log(`  ${t('env.foundFile').replace('{path}', envPath)}`);

  console.log(`  ${t('firefox.checkPrereqs')}`);
  try {
    execSync('web-ext --version', { stdio: 'pipe' });
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
    const cmd = `web-ext sign --api-key="${apiCfg.apiKey}" --api-secret="${apiCfg.apiSecret}" --artifacts-dir="${SIGNED_DIR}" --channel=unlisted`;
    console.log(`  ${t('firefox.execCmd').replace('{cmd}', cmd.replace(apiCfg.apiKey, '***').replace(apiCfg.apiSecret, '***'))}`);

    execSync(cmd, { cwd: FIREFOX_DIR, stdio: 'inherit' });
    console.log(`  ✓ ${t('firefox.signOk')}`);
    finalizeFirefoxArtifact(t, version);
  } catch (e) {
    const message = e && typeof e.message === 'string' ? e.message : '';
    if (message.includes('This upload has already been submitted.')) {
      console.log(`  ⚠ Firefox ${version} has already been submitted to AMO, reusing the existing signed artifact`);
      finalizeFirefoxArtifact(t, version);
      return;
    }
    console.error(`  ✗ ${t('firefox.signFailed').replace('{msg}', e.message)}`);
    process.exit(1);
  }
}

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
      path: path.join(PROJECT_ROOT, 'extensions', 'firefox', 'popup', 'package.json'),
      name: 'extensions/firefox/popup/package.json',
    },
  ];

  for (const workspaceRoot of ['apps', 'packages']) {
    const absRoot = path.join(PROJECT_ROOT, workspaceRoot);
    if (!fs.existsSync(absRoot)) continue;
    for (const entry of fs.readdirSync(absRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(absRoot, entry.name, 'package.json');
      if (fs.existsSync(pkgPath)) {
        files.push({ path: pkgPath, name: `${workspaceRoot}/${entry.name}/package.json` });
      }
    }
  }

  return files;
}

function syncInternalDependencyVersions(content, newVersion) {
  const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  for (const field of dependencyFields) {
    if (!content[field] || typeof content[field] !== 'object') continue;
    for (const name of Object.keys(content[field])) {
      if (name.startsWith('@js-eyes/')) {
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

  console.log('');
  console.log(`  ${t('bump.done')}`);
}

module.exports = {
  buildSite,
  buildChrome,
  buildFirefox,
  bump,
  getVersion,
};
