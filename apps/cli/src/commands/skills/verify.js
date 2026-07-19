'use strict';

const {
  discoverLocalSkills,
  print,
  readSkillById,
  readSkillByIdFromSources,
  verifySkillIntegrity,
} = require('../../command-context');

async function handleVerify({ skillId, skillsDir, sources }) {
const targets = skillId ? [skillId] : discoverLocalSkills(skillsDir).map((s) => s.id);
      let failed = 0;
      for (const id of targets) {
        const skill = readSkillById(skillsDir, id);
        if (!skill) {
          const external = readSkillByIdFromSources({
            id,
            primary: skillsDir,
            extras: sources.extras,
          });
          if (external && external.source === 'extra') {
            print(`- ${id}: SKIPPED (extra source ${external.sourcePath}, no integrity check)`);
            continue;
          }
          print(`- ${id}: NOT INSTALLED`);
          failed++;
          continue;
        }
        const result = verifySkillIntegrity(skill.skillDir);
        if (!result.hasIntegrity) {
          print(`- ${id}: NO integrity manifest`);
          failed++;
          continue;
        }
        if (result.ok) {
          print(`- ${id}: OK (${result.checked} files)`);
        } else {
          print(`- ${id}: FAIL (${result.mismatches.length} mismatched, ${result.missing.length} missing)`);
          for (const m of result.mismatches) print(`    mismatch: ${m}`);
          for (const m of result.missing) print(`    missing: ${m}`);
          failed++;
        }
      }
      if (failed > 0) {
        process.exitCode = 2;
      }
      return;
}

module.exports = { handleVerify };
