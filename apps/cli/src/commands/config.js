'use strict';

const {
  getConfigValue,
  parseConfigValue,
  print,
  setConfigValue,
} = require('../command-context');

async function commandConfig(positionals) {
  const action = positionals[1];
  const key = positionals[2];

  switch (action) {
    case 'get': {
      const value = getConfigValue(key);
      if (key) {
        print(value === undefined ? 'undefined' : JSON.stringify(value, null, 2));
      } else {
        print(JSON.stringify(value, null, 2));
      }
      return;
    }
    case 'set': {
      if (!key || positionals[3] === undefined) {
        throw new Error('用法: js-eyes config set <key> <value>');
      }
      const value = parseConfigValue(positionals[3]);
      const nextConfig = setConfigValue(key, value);
      print(JSON.stringify(nextConfig, null, 2));
      return;
    }
    default:
      throw new Error('支持的命令: `js-eyes config get [key]` / `js-eyes config set <key> <value>`');
  }
}

module.exports = { commandConfig };
