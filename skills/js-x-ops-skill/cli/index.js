'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const contract = require('../skill.contract');

function printUsage(stdout = process.stdout) {
  const lines = [
    'js-x-ops-skill - X.com 内容操作工具',
    '',
    '使用方法:',
    '  node cli/index.js <command> [args...] [options]',
    '',
    '命令:',
    ...contract.cli.commands.map((command) => `  ${command.name.padEnd(12)} ${command.description}`),
    '',
    '提示:',
    '  - 需要 JS-Eyes Server 运行中，且浏览器已安装 JS-Eyes 扩展并登录 X.com',
    '  - 更多帮助可继续追加 --help，例如: node cli/index.js search --help',
    '',
  ];
  stdout.write(lines.join('\n'));
}

function run(argv = process.argv.slice(2), options = {}) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printUsage(options.stdout || process.stdout);
    return { status: 0 };
  }

  const command = argv[0];
  const known = new Set(contract.cli.commands.map((item) => item.name));
  if (!known.has(command)) {
    const stderr = options.stderr || process.stderr;
    stderr.write(`未知命令: ${command}\n\n`);
    printUsage(options.stdout || process.stdout);
    return { status: 1 };
  }

  const entry = path.join(__dirname, '..', 'index.js');
  return spawnSync(process.execPath, [entry, ...argv], {
    cwd: path.join(__dirname, '..'),
    stdio: options.stdio || 'inherit',
    env: options.env || process.env,
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
