#!/usr/bin/env node
'use strict';

const path = require('path');

const { emitCliError, toSkillError } = require('./lib/skillError');
const { installCliAbort } = require('./lib/cliAbort');

const COMMANDS = {
  read: {
    module: './scripts/browser-read',
    description: '读取任意网页正文内容',
  },
  'read-pages': {
    module: './scripts/browser-read-pages',
    description: '批量读取网页正文（并发 / 限流 / 部分成功）',
  },
  interact: {
    module: './scripts/browser-interact',
    description: 'DOM 交互操作（click / fill / scroll / wait）',
  },
};

function printUsage() {
  console.log('\njs-browser-ops-skill - 通用浏览器操作工具');
  console.log('='.repeat(50));
  console.log('\n使用方法:');
  console.log('  node index.js <command> [args...] [options]\n');
  console.log('命令:');
  for (const [command, info] of Object.entries(COMMANDS)) {
    console.log(`  ${command.padEnd(12)} ${info.description}`);
  }
  console.log('\n常用选项:');
  console.log('  --recording-mode off|history|standard|debug');
  console.log('  --debug-recording');
  console.log('  --no-cache');
  console.log('  --recording-base-dir /absolute/path');
  console.log('  --run-id custom-id');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  const commandInfo = COMMANDS[command];
  if (!commandInfo) {
    throw toSkillError('invalid_params', `未知命令: ${command}`);
  }

  const json = args.includes('--json');
  const abort = installCliAbort();
  const originalArgv = [...process.argv];
  process.argv = [process.argv[0], path.join(__dirname, 'index.js'), ...args.slice(1)];

  try {
    const scriptModule = require(commandInfo.module);
    await scriptModule.main({ signal: abort.signal, json });
  } catch (error) {
    const code = emitCliError(error, { json });
    process.exitCode = code;
    process.exit(code);
  } finally {
    abort.dispose();
    process.argv = originalArgv;
  }
}

if (require.main === module) {
  const json = process.argv.includes('--json');
  main().catch((error) => {
    const code = emitCliError(error, { json });
    process.exit(code);
  });
}

module.exports = { main };
