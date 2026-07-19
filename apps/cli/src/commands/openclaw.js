'use strict';

const {
  print,
  resolvePluginPath,
} = require('../command-context');

async function commandOpenClaw(positionals) {
  const action = positionals[1];

  if (action !== 'plugin-path') {
    throw new Error('支持的命令: `js-eyes openclaw plugin-path`');
  }

  print(resolvePluginPath());
}

module.exports = { commandOpenClaw };
