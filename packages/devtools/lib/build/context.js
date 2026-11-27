'use strict';

const { execFileSync, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const SITE_OUT_DIR = path.join(PROJECT_ROOT, 'dist');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const PKG_PATH = path.join(PROJECT_ROOT, 'package.json');
const MAIN_SKILL_TEMPLATE = path.join(
  PROJECT_ROOT,
  'distribution',
  'js-eyes-skill',
  'SKILL.template.md',
);
const SKILL_BUNDLE_FILES = ['SECURITY.md', 'LICENSE'];
const SKILL_ZIP_NAME = 'js-eyes-skill.zip';
const SKILL_BUNDLE_STAGE_ROOT = path.join(DIST_DIR, 'skill-bundle');
const MAIN_SKILL_STAGE_DIR = path.join(SKILL_BUNDLE_STAGE_ROOT, 'js-eyes');
const MAIN_SKILL_DIST_ASSET = (version) => path.join(DIST_DIR, `js-eyes-skill-v${version}.zip`);
const INSTALL_SCRIPTS = ['install.sh', 'install.ps1'];
const BUNDLE_RUNTIME_PACKAGES = [
  'client-sdk',
];
const SKILLS_DIR = path.join(PROJECT_ROOT, 'skills');
const SITE_URL = 'https://js-eyes.com';
const SUB_SKILL_EXCLUDE = [
  'node_modules/**', '**/node_modules/**', 'runs/**', '**/runs/**',
  'work_dir/**', '**/work_dir/**',
  '.git/**', '**/.git/**', '**/.DS_Store', '**/Thumbs.db',
];
const PLATFORM_VERSION_EXCLUDE = new Set([
  'visual-bridge-kit',
  'visual-replay-hyperframes',
  'page-extract',
]);
const PLATFORM_DEPENDENCY_EXCLUDE = new Set(
  Array.from(PLATFORM_VERSION_EXCLUDE, (name) => `@js-eyes/${name}`),
);

function getVersion() {
  try {
    return JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function ensureDir(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function copyDirSync(source, destination) {
  ensureDir(destination);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirSync(sourcePath, destinationPath);
    else fs.copyFileSync(sourcePath, destinationPath);
  }
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function hashFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    size: buffer.length,
  };
}

function writeShaSidecar(zipPath, sha256) {
  fs.writeFileSync(`${zipPath}.sha256`, `${sha256}  ${path.basename(zipPath)}\n`, 'utf8');
}

module.exports = {
  BUNDLE_RUNTIME_PACKAGES,
  DIST_DIR,
  INSTALL_SCRIPTS,
  MAIN_SKILL_DIST_ASSET,
  MAIN_SKILL_STAGE_DIR,
  MAIN_SKILL_TEMPLATE,
  PKG_PATH,
  PLATFORM_DEPENDENCY_EXCLUDE,
  PLATFORM_VERSION_EXCLUDE,
  PROJECT_ROOT,
  SITE_OUT_DIR,
  SITE_URL,
  SKILLS_DIR,
  SKILL_BUNDLE_FILES,
  SKILL_BUNDLE_STAGE_ROOT,
  SKILL_ZIP_NAME,
  SRC_DIR,
  SUB_SKILL_EXCLUDE,
  copyDirSync,
  crypto,
  ensureDir,
  execFileSync,
  execSync,
  formatSize,
  fs,
  getVersion,
  hashFile,
  path,
  writeFile,
  writeShaSidecar,
};
