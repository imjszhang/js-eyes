#!/usr/bin/env node

const path = require('path');

const COMMANDS = {
  search: { module: './scripts/x-search', description: '搜索 X 平台内容' },
  profile: { module: './scripts/x-profile', description: '浏览指定用户主页与时间线' },
  post: { module: './scripts/x-post', description: '读取帖子详情或执行发布操作' },
  home: { module: './scripts/x-home', description: '浏览首页 Feed' },
};

function printUsage() {
  require('./cli').printUsage(process.stdout);
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  const cmdInfo = COMMANDS[command];
  if (!cmdInfo) {
    console.error(`错误: 未知命令 "${command}"`);
    console.error('可用命令:', Object.keys(COMMANDS).join(', '));
    printUsage();
    process.exit(1);
  }

  const remainingArgs = argv.slice(1);
  const originalArgv = [...process.argv];
  process.argv = [process.argv[0], path.join(__dirname, 'index.js'), ...remainingArgs];

  try {
    const scriptPath = path.join(__dirname, 'scripts', `x-${command}.js`);
    const scriptModule = require(scriptPath);
    if (typeof scriptModule.main === 'function') {
      await scriptModule.main();
    } else {
      console.error(`错误: 命令 ${command} 未导出 main 函数`);
      process.exit(1);
    }
  } catch (error) {
    console.error('执行失败:', error.message);
    if (error.stack) {
      console.error('\n堆栈跟踪:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    process.argv = originalArgv;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('未处理的错误:', error);
    process.exit(1);
  });
}

module.exports = {
  COMMANDS,
  main,
  printUsage,
};
