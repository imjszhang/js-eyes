#!/usr/bin/env node
'use strict';

/**
 * scan-clawhub-patterns.js — local reproduction of the ClawHub v2.6.1 static
 * analysis heuristics. Fast, dependency-free, AST-light: it uses regex + a
 * small line-range check that mirrors the semantic categories ClawHub surfaces
 * on https://clawhub.ai/imjszhang/js-eyes:
 *
 *   1. Shell command execution  — require('child_process') / spawn / exec
 *   2. Env + network send       — process.env reads co-located with WS/HTTP
 *   3. File read + network send — fs.readFileSync / createReadStream co-located
 *                                 with WS/HTTP
 *
 * Scope = shipped bundle code only: we deliberately skip `test/`, `node_modules`,
 * bundled zips, docs, examples, and the devtools builder — same scope the
 * ClawHub scanner sees after extracting the skill bundle.
 *
 * Exit code: number of findings (so CI can threshold ≤ 1 per
 * SECURITY_SCAN_NOTES.md). Use `--json` for machine-readable output.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// Scope matches what ClawHub v2.6.1 surfaced publicly (all 5 findings were
// pinned to packages/protocol/ and openclaw-plugin/). That is exactly the
// plugin runtime path — code that actually loads inside OpenClaw. Standalone
// CLIs (apps/cli, apps/native-host) and network client packages (client-sdk,
// server-core) are out of scope: the former never run inside the plugin
// process, and the latter are network modules by design where env/fs reads
// next to WebSocket/HTTP are expected and audited separately.
const INCLUDE_PATHS = [
  'packages/protocol',
  'openclaw-plugin',
];

// Expected residuals after the 2.6.2 refactor. Each entry is a single-purpose
// hardened module whose *only* job is to safely own one of the patterns the
// scanner flags; each is documented in SECURITY_SCAN_NOTES.md with the full
// argument for why it must exist. We keep them in this file so a fresh
// auditor can diff the allowlist against the live scan output in one glance.
//
// Format: { rule, file } — matching is exact on `path.relative` (posix).
const EXPECTED_RESIDUALS = [
  {
    rule: 'shell',
    file: 'packages/protocol/safe-npm.js',
    reason: 'The hardened replacement for the flagged skills.js:536 npm call. ' +
      'See SECURITY_SCAN_NOTES.md §1.',
  },
  {
    rule: 'shell',
    file: 'packages/protocol/skill-runner.js',
    reason: 'Launches a sub-skill\'s own Node CLI with argv[0]=process.execPath, ' +
      'shell:false, windowsHide:true. See SECURITY_SCAN_NOTES.md §1.',
  },
  {
    rule: 'shell',
    file: 'openclaw-plugin/windows-hide-patch.mjs',
    reason: 'Windows-only no-op on POSIX; on Windows it wraps spawn/execFile ' +
      'to default windowsHide:true. See SECURITY_SCAN_NOTES.md §1.',
  },
];

const EXCLUDE_PATH_FRAGMENTS = [
  '/node_modules/',
  '/dist/',
  '/build/',
  '/coverage/',
  '/fixtures/',
  '/__tests__/',
  '/.git/',
  '/test/',
  '/tests/',
];

const FILE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

const RULES = {
  shell: {
    label: 'Shell command execution detected (child_process).',
    triggers: [
      /require\(\s*['"]child_process['"]\s*\)/,
      /from\s+['"]child_process['"]/,
      /from\s+['"]node:child_process['"]/,
      /require\(\s*['"]node:child_process['"]\s*\)/,
    ],
  },
  envNet: {
    label: 'Environment variable access combined with network send.',
    envTriggers: [/process\.env\.[A-Z0-9_]/i, /process\.env\[['"][^'"]+['"]\]/],
    netTriggers: [
      /require\(\s*['"]ws['"]\s*\)/,
      /require\(\s*['"]http['"]\s*\)/,
      /require\(\s*['"]https['"]\s*\)/,
      /require\(\s*['"]net['"]\s*\)/,
      /require\(\s*['"]node:http['"]\s*\)/,
      /require\(\s*['"]node:https['"]\s*\)/,
      /require\(\s*['"]node:net['"]\s*\)/,
      /from\s+['"]ws['"]/,
      /from\s+['"]http['"]/,
      /from\s+['"]https['"]/,
      /from\s+['"]net['"]/,
      /from\s+['"]node:http['"]/,
      /from\s+['"]node:https['"]/,
      /from\s+['"]node:net['"]/,
      /new\s+WebSocket\(/,
      /\bfetch\(/,
    ],
  },
  fileNet: {
    label: 'File read combined with network send (possible exfiltration).',
    fsTriggers: [
      /fs\.readFileSync\(/,
      /fs\.readFile\(/,
      /fs\.createReadStream\(/,
      /\breadFileSync\(/,
      /\breadFile\(/,
      /\bcreateReadStream\(/,
    ],
    netTriggers: [
      /require\(\s*['"]ws['"]\s*\)/,
      /require\(\s*['"]http['"]\s*\)/,
      /require\(\s*['"]https['"]\s*\)/,
      /require\(\s*['"]net['"]\s*\)/,
      /require\(\s*['"]node:http['"]\s*\)/,
      /require\(\s*['"]node:https['"]\s*\)/,
      /require\(\s*['"]node:net['"]\s*\)/,
      /from\s+['"]ws['"]/,
      /from\s+['"]http['"]/,
      /from\s+['"]https['"]/,
      /from\s+['"]net['"]/,
      /from\s+['"]node:http['"]/,
      /from\s+['"]node:https['"]/,
      /from\s+['"]node:net['"]/,
      /new\s+WebSocket\(/,
      /\bfetch\(/,
    ],
  },
};

function shouldSkip(absPath) {
  const rel = path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
  if (rel.startsWith('..')) return true;
  const needle = `/${rel}/`;
  return EXCLUDE_PATH_FRAGMENTS.some((frag) => needle.includes(frag));
}

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (shouldSkip(abs)) continue;
    if (entry.isDirectory()) {
      yield* walk(abs);
    } else if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
      yield abs;
    }
  }
}

function firstMatch(regexList, text) {
  for (const re of regexList) {
    const m = text.match(re);
    if (m) return m;
  }
  return null;
}

function firstMatchLine(regexList, lines) {
  for (let i = 0; i < lines.length; i++) {
    for (const re of regexList) {
      if (re.test(lines[i])) {
        return { line: i + 1, snippet: lines[i].trim().slice(0, 200) };
      }
    }
  }
  return null;
}

// Strip // line comments and /* */ block comments so regex-matching doesn't
// surface prose hits from documentation / SECURITY_SCAN_NOTES pointers inside
// module headers. We preserve line numbering by replacing stripped content
// with spaces and newlines — that way `firstMatchLine` still reports the real
// source line for a trigger.
function stripComments(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  let inString = null;
  let inTemplate = false;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out.push(ch);
      if (ch === '\\' && i + 1 < n) {
        out.push(next);
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (inTemplate) {
      out.push(ch);
      if (ch === '\\' && i + 1 < n) {
        out.push(next);
        i += 2;
        continue;
      }
      if (ch === '`') inTemplate = false;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      // line comment — consume until newline
      while (i < n && text[i] !== '\n') {
        out.push(' ');
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      // block comment — preserve newlines, blank out everything else
      i += 2;
      out.push(' ');
      out.push(' ');
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        out.push(text[i] === '\n' ? '\n' : ' ');
        i += 1;
      }
      if (i < n) {
        i += 2;
        out.push(' ');
        out.push(' ');
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      out.push(ch);
      i += 1;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      out.push(ch);
      i += 1;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join('');
}

function scanFile(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  const text = stripComments(raw);
  const lines = text.split(/\r?\n/);
  const rel = path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
  const findings = [];

  const shellHit = firstMatchLine(RULES.shell.triggers, lines);
  if (shellHit) {
    findings.push({
      rule: 'shell',
      file: rel,
      line: shellHit.line,
      label: RULES.shell.label,
      snippet: shellHit.snippet,
    });
  }

  const envHit = firstMatchLine(RULES.envNet.envTriggers, lines);
  const envNetHit = firstMatchLine(RULES.envNet.netTriggers, lines);
  if (envHit && envNetHit) {
    findings.push({
      rule: 'env+net',
      file: rel,
      line: envHit.line,
      label: RULES.envNet.label,
      snippet: envHit.snippet,
      coLocatedNetworkLine: envNetHit.line,
    });
  }

  const fsHit = firstMatchLine(RULES.fileNet.fsTriggers, lines);
  const fsNetHit = firstMatchLine(RULES.fileNet.netTriggers, lines);
  if (fsHit && fsNetHit) {
    findings.push({
      rule: 'file+net',
      file: rel,
      line: fsHit.line,
      label: RULES.fileNet.label,
      snippet: fsHit.snippet,
      coLocatedNetworkLine: fsNetHit.line,
    });
  }

  return findings;
}

function main() {
  const jsonMode = process.argv.includes('--json');
  const allFindings = [];

  for (const include of INCLUDE_PATHS) {
    const abs = path.join(REPO_ROOT, include);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (FILE_EXTENSIONS.has(path.extname(abs))) {
        allFindings.push(...scanFile(abs));
      }
      continue;
    }
    for (const file of walk(abs)) {
      allFindings.push(...scanFile(file));
    }
  }

  const expectedKey = (f) => `${f.rule}::${f.file}`;
  const expectedSet = new Set(EXPECTED_RESIDUALS.map(expectedKey));
  const expected = [];
  const unexpected = [];
  for (const finding of allFindings) {
    if (expectedSet.has(expectedKey(finding))) {
      expected.push(finding);
    } else {
      unexpected.push(finding);
    }
  }

  const summary = {
    scannedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    totalFindings: allFindings.length,
    expectedFindings: expected.length,
    unexpectedFindings: unexpected.length,
    byRule: allFindings.reduce((acc, f) => {
      acc[f.rule] = (acc[f.rule] || 0) + 1;
      return acc;
    }, {}),
    allowlist: EXPECTED_RESIDUALS,
    expected,
    unexpected,
  };

  if (jsonMode) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    const header = `ClawHub-equivalent scan — js-eyes ${require(path.join(REPO_ROOT, 'package.json')).version}`;
    process.stdout.write(`${header}\n`);
    process.stdout.write('='.repeat(header.length) + '\n\n');
    if (allFindings.length === 0) {
      process.stdout.write('No findings.\n');
    } else {
      process.stdout.write(`Scope: ${INCLUDE_PATHS.join(', ')}\n\n`);
      if (unexpected.length > 0) {
        process.stdout.write(`UNEXPECTED (${unexpected.length}) — must be triaged:\n`);
        for (const f of unexpected) {
          process.stdout.write(`  • [${f.rule}] ${f.file}:${f.line}\n`);
          process.stdout.write(`      ${f.label}\n`);
          process.stdout.write(`      ${f.snippet}\n`);
          if (f.coLocatedNetworkLine) {
            process.stdout.write(`      (co-located network import / call at line ${f.coLocatedNetworkLine})\n`);
          }
        }
        process.stdout.write('\n');
      }
      if (expected.length > 0) {
        process.stdout.write(`EXPECTED residuals (${expected.length}) — documented in SECURITY_SCAN_NOTES.md:\n`);
        for (const f of expected) {
          const note = EXPECTED_RESIDUALS.find((r) => r.rule === f.rule && r.file === f.file);
          process.stdout.write(`  • [${f.rule}] ${f.file}:${f.line}\n`);
          process.stdout.write(`      ${f.label}\n`);
          if (note) process.stdout.write(`      reason: ${note.reason}\n`);
        }
        process.stdout.write('\n');
      }
    }
    process.stdout.write(
      `Total: ${allFindings.length} (expected: ${expected.length}, unexpected: ${unexpected.length})\n`
    );
    if (unexpected.length > 0) {
      process.stdout.write('Unexpected findings must be either refactored or explicitly allowlisted ' +
        'with a SECURITY_SCAN_NOTES.md entry.\n');
    }
  }

  // Exit 0 when all findings are expected residuals, 1 otherwise. This lets
  // CI gate on "no new unexpected findings" while the structural minimum
  // stays in place.
  process.exit(unexpected.length === 0 ? 0 : 1);
}

main();
