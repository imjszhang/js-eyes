'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Trust digests intentionally include dependencies and generated entry files.
// Skill-owned mutable state belongs under the host storage root, outside the
// source tree, so only VCS metadata is excluded by default.
const DEFAULT_IGNORED_DIRS = Object.freeze(['.git']);

function computeSkillSourceDigest(skillDir, options = {}) {
  const root = fs.realpathSync(skillDir);
  const ignoredDirs = new Set(options.ignoredDirs || DEFAULT_IGNORED_DIRS);
  const records = [];
  const visitedDirs = new Set();

  function walk(current, logicalPrefix = '') {
    const currentReal = fs.realpathSync(current);
    if (visitedDirs.has(currentReal)) return;
    visitedDirs.add(currentReal);
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (ignoredDirs.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      const logicalPath = logicalPrefix ? `${logicalPrefix}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(fullPath);
        const resolved = fs.realpathSync(fullPath);
        const resolvedStat = fs.statSync(resolved);
        records.push({ type: 'link', path: logicalPath, value: linkTarget });
        if (resolvedStat.isDirectory()) walk(resolved, `${logicalPath}@target`);
        else if (resolvedStat.isFile()) records.push({ type: 'file', path: `${logicalPath}@target`, filePath: resolved });
      } else if (stat.isDirectory()) {
        walk(fullPath, logicalPath);
      } else if (stat.isFile()) {
        records.push({ type: 'file', path: logicalPath, filePath: fullPath });
      }
    }
  }

  walk(root);
  records.sort((left, right) => left.path.localeCompare(right.path));
  const hash = crypto.createHash('sha256');
  for (const record of records) {
    hash.update(record.type);
    hash.update('\0');
    hash.update(record.path);
    hash.update('\0');
    if (record.type === 'file') hash.update(fs.readFileSync(record.filePath));
    else hash.update(record.value);
    hash.update('\0');
  }
  return hash.digest('hex');
}

module.exports = { DEFAULT_IGNORED_DIRS, computeSkillSourceDigest };
