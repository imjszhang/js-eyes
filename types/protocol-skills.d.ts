declare module '@js-eyes/protocol/skills' {
  export const applySkillInstall: (...args: any[]) => any;
  export const cleanupStaging: (...args: any[]) => any;
  export const discoverLocalSkills: (...args: any[]) => any;
  export const discoverSkillsFromSources: (...args: any[]) => any;
  export const fetchSkillsRegistry: (...args: any[]) => any;
  export const getLegacyOpenClawSkillState: (...args: any[]) => any;
  export const installSkillFromRegistry: (...args: any[]) => any;
  export const isSkillEnabled: (...args: any[]) => any;
  export const planSkillInstall: (...args: any[]) => any;
  export const readSkillById: (...args: any[]) => any;
  export const readSkillByIdFromSources: (...args: any[]) => any;
  export const readSkillIntegrity: (...args: any[]) => any;
  export const resolveSkillSources: (...args: any[]) => any;
  export const resolveSkillsDir: (...args: any[]) => any;
  export const runSkillCli: (...args: any[]) => any;
  export const skillToolActionName: (...args: any[]) => any;
  export const verifySkillIntegrity: (...args: any[]) => any;
}

declare module '@js-eyes/protocol/skills.js' {
  export const discoverSkillsFromSources: (...args: any[]) => any;
  export const fetchSkillsRegistry: (...args: any[]) => any;
  export const planSkillInstall: (...args: any[]) => any;
  export const resolveSkillSources: (...args: any[]) => any;
  export const skillToolActionName: (...args: any[]) => any;
}
