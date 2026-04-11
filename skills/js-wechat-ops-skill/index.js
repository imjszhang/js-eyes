#!/usr/bin/env node
'use strict';

const path = require('path');

const COMMANDS = {
  article: {
    module: './scripts/wechat-article',
    description: '读取微信公众号文章详情',
  },
};

function printUsage() {
  console.log('\njs-wechat-ops-skill - 微信公众号内容读取工具');
  console.log('='.repeat(50));
  console.log('\n使用方法:');
  console.log('  node index.js <command> [args...] [options]\n');
  console.log('命令:');
  for (const [command, info] of Object.entries(COMMANDS)) {
    console.log(`  ${command.padEnd(12)} ${info.description}`);
  }
  console.log('\n示例:');
  console.log('  node index.js article "https://mp.weixin.qq.com/s/xxxx" --pretty');
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

module.exports = { main };
