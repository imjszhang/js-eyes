#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { CANONICAL_REPOSITORY_URL, RELEASE_PACKAGES } = require('./release-packages');

const root = path.resolve(__dirname, '..');
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function fail(message) {
  throw new Error(`release verification: ${message}`);
}

function extractReleaseNotes(version) {
  const source = fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## v${escaped}\\s*$`, 'm').exec(source);
  if (!heading) return null;
  const rest = source.slice(heading.index + heading[0].length);
  const nextHeading = rest.search(/^## v/m);
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
}

const version = readJson('package.json').version;
if (!semverPattern.test(version)) fail(`invalid root version ${version}`);

const versionFiles = [
  ...RELEASE_PACKAGES.map((entry) => `${entry.dir}/package.json`),
  'packages/devtools/package.json',
  'openclaw-plugin/package.json',
  'openclaw-plugin/openclaw.plugin.json',
  'extensions/chrome/manifest.json',
  'extensions/firefox/manifest.json',
  'extensions/firefox/popup/package.json',
];

for (const relativePath of versionFiles) {
  const actual = readJson(relativePath).version;
  if (actual !== version) fail(`${relativePath} has version ${actual}, expected ${version}`);
}

for (const entry of RELEASE_PACKAGES) {
  const manifest = readJson(`${entry.dir}/package.json`);
  if (manifest.name !== entry.name) fail(`${entry.dir} has unexpected package name ${manifest.name}`);
  if (!manifest.repository || manifest.repository.url !== CANONICAL_REPOSITORY_URL) {
    fail(`${entry.name} repository.url must be ${CANONICAL_REPOSITORY_URL}`);
  }
}

const expectedVersion = process.env.EXPECTED_VERSION;
if (expectedVersion && expectedVersion !== version) {
  fail(`confirmed version ${expectedVersion} does not match repository version ${version}`);
}

if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  fail(`tag ${process.env.GITHUB_REF_NAME} does not match v${version}`);
}

const notes = extractReleaseNotes(version);
if (!notes) fail(`RELEASE_NOTES.md is missing a ## v${version} section`);

const notesFlag = process.argv.indexOf('--write-notes');
if (notesFlag !== -1) {
  const destination = process.argv[notesFlag + 1];
  if (!destination) fail('--write-notes requires a path');
  const absoluteDestination = path.resolve(root, destination);
  fs.mkdirSync(path.dirname(absoluteDestination), { recursive: true });
  fs.writeFileSync(absoluteDestination, `${notes}\n`, 'utf8');
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
}

console.log(`release verification: v${version}, ${RELEASE_PACKAGES.length} npm packages, notes present`);
