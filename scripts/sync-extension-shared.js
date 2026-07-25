#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  FORWARDABLE_ACTIONS,
  SENSITIVE_BROWSER_ACTIONS,
} = require('../packages/protocol');
const {
  EXTENSION_SHARED_COPIES,
  EXTENSIONS_DIR,
  PROJECT_ROOT,
} = require('../packages/devtools/lib/build/context');
const { stageAllExtensions } = require('../packages/devtools/lib/build/extensions');

const root = PROJECT_ROOT;
const write = process.argv.includes('--write');

function validateBrowserOperationCatalog() {
  const config = require('../extensions/shared/config');
  const allowed = new Set(config.SECURITY?.allowedActions || []);
  const sensitive = new Set(config.SECURITY?.sensitiveActions || []);
  const missingAllowed = FORWARDABLE_ACTIONS.filter((action) => !allowed.has(action));
  const missingSensitive = SENSITIVE_BROWSER_ACTIONS.filter((action) => !sensitive.has(action));
  const unexpectedSensitive = [...sensitive]
    .filter((action) => !SENSITIVE_BROWSER_ACTIONS.includes(action));
  if (missingAllowed.length || missingSensitive.length || unexpectedSensitive.length) {
    if (missingAllowed.length) {
      console.error(`extension allowedActions missing: ${missingAllowed.join(', ')}`);
    }
    if (missingSensitive.length) {
      console.error(`extension sensitiveActions missing: ${missingSensitive.join(', ')}`);
    }
    if (unexpectedSensitive.length) {
      console.error(`extension sensitiveActions not in browser catalog: ${unexpectedSensitive.join(', ')}`);
    }
    return false;
  }
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

function validateSharedSourcesExist() {
  let ok = true;
  for (const [sourceName] of EXTENSION_SHARED_COPIES) {
    const sourcePath = path.join(EXTENSIONS_DIR, 'shared', sourceName);
    if (!fs.existsSync(sourcePath)) {
      console.error(`missing shared runtime source: ${path.relative(root, sourcePath)}`);
      ok = false;
    }
  }
  return ok;
}

let ok = validateBrowserOperationCatalog()
  && migrateChromeInlineRuntime()
  && validateSharedSourcesExist();

if (!ok) {
  console.error('Extension shared catalog/source validation failed.');
  process.exit(1);
}

if (write) {
  const staged = stageAllExtensions();
  console.log(`staged chrome -> ${path.relative(root, staged.chrome)}`);
  console.log(`staged firefox -> ${path.relative(root, staged.firefox)}`);
} else {
  console.log('extension shared catalog and sources are valid');
  console.log('run `npm run sync:extension-shared` to prepare dist/extensions-stage for unpacked loading');
}
