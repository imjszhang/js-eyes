'use strict';

const { flagsToArgv, parseArgs } = require('./lib/args');
const { getLoopbackOrigin, getServerOptions, isProcessAlive, readPid } = require('./lib/runtime');
const { compareSemver, parseSemver } = require('./lib/semver');
const { resolvePluginPath } = require('./command-context');
const { commandAudit } = require('./commands/audit');
const { commandConfig } = require('./commands/config');
const { commandConsent } = require('./commands/consent');
const { commandDoctor, commandStatus } = require('./commands/doctor');
const { commandEgress } = require('./commands/egress');
const { commandExtension, resolveExtensionAsset } = require('./commands/extension');
const { printHelp } = require('./commands/help');
const { commandNativeHost } = require('./commands/native-host');
const { commandSecurity } = require('./commands/security');
const { commandServer } = require('./commands/server');
const { commandSkill } = require('./commands/skill');
const { commandSkills } = require('./commands/skills');

async function main(argv = process.argv.slice(2)) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];

  switch (command) {
    case 'server':
      await commandServer(positionals, flags);
      return;
    case 'status':
      await commandStatus(flags);
      return;
    case 'doctor':
      await commandDoctor(flags);
      return;
    case 'config':
      await commandConfig(positionals);
      return;
    case 'skills':
      await commandSkills(positionals, flags);
      return;
    case 'skill':
      await commandSkill(positionals, flags);
      return;
    case 'openclaw':
      await require('./commands/openclaw').commandOpenClaw(positionals);
      return;
    case 'extension':
      await commandExtension(positionals, flags);
      return;
    case 'audit':
      await commandAudit(positionals, flags);
      return;
    case 'consent':
      await commandConsent(positionals);
      return;
    case 'egress':
      await commandEgress(positionals, flags);
      return;
    case 'security':
      await commandSecurity(positionals, flags);
      return;
    case 'native-host':
      await commandNativeHost(positionals, flags);
      return;
    case '--help':
    case '-h':
    case 'help':
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`未知命令: ${command}`);
  }
}

module.exports = {
  commandDoctor,
  commandEgress,
  commandExtension,
  commandNativeHost,
  commandSecurity,
  commandSkill,
  commandSkills,
  commandStatus,
  compareSemver,
  flagsToArgv,
  getServerOptions,
  getLoopbackOrigin,
  isProcessAlive,
  main,
  parseArgs,
  parseSemver,
  readPid,
  resolveExtensionAsset,
  resolvePluginPath,
};
