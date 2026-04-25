'use strict';

// Import-boundary test: guarantees the modules extracted during the 2.6.2
// security-hygiene refactor never pull in a network client.
//
// Why this matters: ClawHub / VirusTotal static analyzers flag "env read +
// network send" and "file read + network send" when both patterns appear in
// the same file. We deliberately split those concerns across dedicated
// modules; if a future edit re-imports `ws` / `http` / `https` / `net` (or
// any package that wraps them), the scanner will regress. This test keeps
// that invariant mechanical.

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');

const FORBIDDEN_SPECIFIERS = Object.freeze([
  'ws',
  'http',
  'https',
  'net',
  'node:http',
  'node:https',
  'node:net',
  'node:tls',
  'tls',
  'node-fetch',
  '../packages/client-sdk',
  '../packages/server-core',
  '../../packages/client-sdk',
  '../../packages/server-core',
  '../../../packages/client-sdk',
  '../../../packages/server-core',
]);

const FORBIDDEN_GLOBALS = Object.freeze([
  // Prevent accidental use of fetch() which is a network egress surface too.
  /\bfetch\s*\(/,
  /\bnew\s+WebSocket\b/,
]);

const GUARDED_FILES = Object.freeze([
  'packages/protocol/fs-io.js',
  'packages/protocol/openclaw-paths.js',
  'packages/protocol/safe-npm.js',
  'packages/protocol/skill-runner.js',
  'openclaw-plugin/auth.mjs',
  'openclaw-plugin/fs-utils/hash.mjs',
  'openclaw-plugin/windows-hide-patch.mjs',
]);

function extractSpecifiers(source) {
  const specs = new Set();
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const importRe = /import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const re of [requireRe, importRe, dynamicImportRe]) {
    let match;
    while ((match = re.exec(source)) !== null) {
      specs.add(match[1]);
    }
  }
  return specs;
}

describe('import boundaries for security-hygiene modules', () => {
  for (const rel of GUARDED_FILES) {
    it(`${rel} must not import network transports`, () => {
      const abs = path.join(repoRoot, rel);
      assert.ok(fs.existsSync(abs), `expected ${rel} to exist`);
      const source = fs.readFileSync(abs, 'utf8');
      const specs = extractSpecifiers(source);

      const violations = [];
      for (const bad of FORBIDDEN_SPECIFIERS) {
        if (specs.has(bad)) {
          violations.push(`forbidden import "${bad}"`);
        }
      }
      for (const re of FORBIDDEN_GLOBALS) {
        if (re.test(source)) {
          violations.push(`forbidden pattern ${re}`);
        }
      }

      assert.deepEqual(
        violations,
        [],
        `${rel} leaked a network import/pattern: ${violations.join(', ')}`,
      );
    });
  }
});
