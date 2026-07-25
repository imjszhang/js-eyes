#!/usr/bin/env node
'use strict';

const path = require('path');

const COMMANDS = {
  title: {
    module: './scripts/hello',
    description: '读取指定标签页的标题',
  },
};

function printUsage() {
  console.log('\njs-hello-ops-skill - JS Eyes Skills 最小样例');
  console.log('='.repeat(50));
  console.log('\n使用方法:');
  console.log('  node index.js <command> [args...] [options]\n');
  console.log('命令:');
  for (const [command, info] of Object.entries(COMMANDS)) {
    console.log(`  ${command.padEnd(8)} ${info.description}`);
  }
  console.log('\n示例:');
  console.log('  node index.js title 123');
  console.log('  node index.js title 123 --target firefox');
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
    throw new Error(`未知命令: ${command}`);
  }

  const originalArgv = [...process.argv];
  process.argv = [process.argv[0], path.join(__dirname, 'index.js'), ...args.slice(1)];

  try {
    const scriptModule = require(commandInfo.module);
    await scriptModule.main();
  } finally {
    process.argv = originalArgv;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main, COMMANDS };
