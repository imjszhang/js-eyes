# examples/legacy/

V1 Skill samples (`skill.contract.js` / `createOpenClawAdapter`) have been
**removed**. JS Eyes no longer activates V1 skills.

Use [`examples/js-eyes-skills/`](../js-eyes-skills/) for the Skill Runtime V2
template (`skill.manifest.json` + `skill.entry.js` + `@js-eyes/skill-scaffold`).

If you still have an external V1 skill in the field, migrate it before upgrading:
declare tools in a V2 manifest, move handlers into `skill.entry.js`, and approve
the skill again under `externalSkills.policy` `prompt` or `strict`.
