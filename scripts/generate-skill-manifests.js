'use strict';

const fs = require('fs');
const path = require('path');
const { buildSkillManifest } = require('@js-eyes/skill-scaffold');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');
const VERIFY = process.argv.includes('--check');

let stale = false;
for (const name of fs.readdirSync(SKILLS_ROOT).sort()) {
  const skillDir = path.join(SKILLS_ROOT, name);
  if (!fs.existsSync(path.join(skillDir, 'skill.definition.js'))) continue;
  const manifestPath = path.join(skillDir, 'skill.manifest.json');
  let expected;
  try {
    expected = `${JSON.stringify(buildSkillManifest(skillDir), null, 2)}\n`;
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
    continue;
  }
  const actual = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : '';
  if (actual === expected) continue;
  stale = true;
  if (VERIFY) console.error(`stale skill manifest: ${path.relative(ROOT, manifestPath)}`);
  else fs.writeFileSync(manifestPath, expected);
}

if (VERIFY && stale) process.exitCode = 1;
