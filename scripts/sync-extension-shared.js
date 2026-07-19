#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const write = process.argv.includes('--write');

const copies = [
  ['extensions/shared/config.js', 'extensions/chrome/config.js'],
  ['extensions/shared/config.js', 'extensions/firefox/config.js'],
  ['extensions/shared/utils.js', 'extensions/chrome/background/utils.js'],
  ['extensions/shared/utils.js', 'extensions/firefox/background/utils.js'],
  ['extensions/shared/connection-methods.js', 'extensions/chrome/background/connection-methods.js'],
  ['extensions/shared/connection-methods.js', 'extensions/firefox/background/connection-methods.js'],
  ['extensions/shared/messaging-methods.js', 'extensions/chrome/background/messaging-methods.js'],
  ['extensions/shared/messaging-methods.js', 'extensions/firefox/background/messaging-methods.js'],
  ['extensions/shared/operations-methods.js', 'extensions/chrome/background/operations-methods.js'],
  ['extensions/shared/operations-methods.js', 'extensions/firefox/background/operations-methods.js'],
  ['extensions/shared/routing-methods.js', 'extensions/chrome/background/routing-methods.js'],
  ['extensions/shared/routing-methods.js', 'extensions/firefox/background/routing-methods.js'],
  ['extensions/shared/tabs-methods.js', 'extensions/chrome/background/tabs-methods.js'],
  ['extensions/shared/tabs-methods.js', 'extensions/firefox/background/tabs-methods.js'],
  ['extensions/shared/browser-control-methods.js', 'extensions/chrome/background/browser-control-methods.js'],
  ['extensions/shared/browser-control-methods.js', 'extensions/firefox/background/browser-control-methods.js'],
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function writeCopy(source, target) {
  const sourceText = read(source);
  const targetPath = path.join(root, target);
  const targetText = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;
  if (sourceText === targetText) return true;
  if (!write) {
    console.error(`${target} is out of sync with ${source}`);
    return false;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, sourceText, 'utf8');
  console.log(`synced ${target}`);
  return true;
}

function migrateChromeInlineRuntime() {
  const relativePath = 'extensions/chrome/background/background.js';
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const inlineStart = source.indexOf('// 内联配置（因为 Service Worker 不能使用 importScripts）');
  if (inlineStart === -1) return true;
  if (!write) {
    console.error(`${relativePath} still contains the legacy inline shared runtime`);
    return false;
  }
  const classStart = source.indexOf('class BrowserControl', inlineStart);
  if (classStart === -1) throw new Error('BrowserControl class marker not found');
  const imports = [
    "import '../config.js';",
    "import './utils.js';",
    '',
    'const EXTENSION_CONFIG = globalThis.EXTENSION_CONFIG;',
    'const {',
    '  withTimeout,',
    '  RateLimiter,',
    '  RequestDeduplicator,',
    '  RequestQueueManager,',
    '  HealthChecker,',
    '} = globalThis.ExtensionUtils;',
    '',
  ].join('\n');
  fs.writeFileSync(filePath, `${source.slice(0, inlineStart)}${imports}${source.slice(classStart)}`, 'utf8');
  console.log(`removed legacy inline runtime from ${relativePath}`);
  return true;
}

let ok = migrateChromeInlineRuntime();
for (const [source, target] of copies) ok = writeCopy(source, target) && ok;

if (!ok) {
  console.error('Run `npm run sync:extension-shared` and commit the generated copies.');
  process.exit(1);
}

if (!write) console.log('extension shared runtime copies are in sync');
