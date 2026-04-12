'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const contract = require('../skill.contract');

function printUsage(stdout = process.stdout) {
  const lines = [
    'js-jike-ops-skill - 即刻内容读取工具',
    '',
    '使用方法:',
    '  node cli/index.js <command> [args...] [options]',
    '',
    '命令:',
    ...contract.cli.commands.map((command) => `  ${command.name.padEnd(12)} ${command.description}`),
    '',
  ];
  stdout.write(lines.join('\n'));
}

function run(argv = process.argv.slice(2), options = {}) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printUsage(options.stdout || process.stdout);
    return { status: 0 };
  }

  const entry = path.join(__dirname, '..', 'index.js');
  return spawnSync(process.execPath, [entry, ...argv], {
    cwd: path.join(__dirname, '..'),
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
    encoding: options.stdio === 'pipe' ? 'utf8' : undefined,
  });
}

if (require.main === module) {
  const result = run(process.argv.slice(2), { stdio: 'inherit' });
  process.exit(result.status || 0);
}

module.exports = {
  printUsage,
  run,
};
