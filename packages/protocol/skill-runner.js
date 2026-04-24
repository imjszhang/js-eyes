'use strict';

// skill-runner: launches a sub-skill's own Node CLI entry.
//
// Kept out of skills.js so the only `child_process` call in @js-eyes/protocol
// that lives on skills.js's transitive imports is safe-npm.js (which has its
// own hardening). This module MUST NOT import `ws`, `http`, `https`, `net`,
// or any network helper — the invariant is enforced by
// test/import-boundaries.test.js.
//
// Contract:
//   * `process.execPath` is the argv[0] — we never invoke a shell;
//   * argv entries are forwarded verbatim from the caller; spawnSync is
//     always called with `shell: false` and `windowsHide: true`;
//   * the caller's env is inherited (extended with `JS_EYES_SKILL_DIR`).
//     Unlike safe-npm we do not filter env here because the skill CLI
//     legitimately needs the full environment — sub-skills are on-disk code
//     the operator has already linked/approved via the integrity workflow.
//
// See SECURITY_SCAN_NOTES.md ("Shell command execution").

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function runSkillCli(options) {
  const { skillDir, argv = [], stdio = 'inherit', env = process.env } = options;
  if (!skillDir || typeof skillDir !== 'string') {
    throw new TypeError('runSkillCli: skillDir is required');
  }

  const { normalizeSkillMetadata } = require('./skills');
  const skill = normalizeSkillMetadata(skillDir);
  if (!fs.existsSync(skill.cliEntry)) {
    throw new Error(`技能 ${skill.id} 缺少 CLI 入口: ${skill.cliEntry}`);
  }

  return spawnSync(process.execPath, [skill.cliEntry, ...argv], {
    cwd: skillDir,
    env: { ...env, JS_EYES_SKILL_DIR: skillDir },
    stdio,
    shell: false,
    windowsHide: true,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
  });
}

module.exports = { runSkillCli };
