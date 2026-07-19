'use strict';

function parseArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }

  return { positionals, flags };
}

function flagsToArgv(flags) {
  const argv = [];
  for (const [key, value] of Object.entries(flags)) {
    argv.push(`--${key}`);
    if (value !== true) {
      argv.push(String(value));
    }
  }
  return argv;
}

module.exports = { flagsToArgv, parseArgs };
