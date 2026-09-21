'use strict';

const {
  deleteSecret,
  listSecretNames,
  writeSecret,
} = require('@js-eyes/runtime-paths/secrets');
const { print } = require('../command-context');

async function readStdinValue() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').replace(/\n$/, '');
}

async function commandSecrets(positionals, flags = {}) {
  const action = positionals[1];
  switch (action) {
    case 'list': {
      const names = listSecretNames();
      if (names.length === 0) {
        print('No secrets stored.');
        return;
      }
      for (const name of names) print(name);
      return;
    }
    case 'set': {
      const name = positionals[2] || flags.name;
      if (!name) throw new Error('用法: js-eyes secrets set <name> [--value <text>]');
      const value = flags.value != null ? String(flags.value) : await readStdinValue();
      if (!value) throw new Error('缺少 secret 值（使用 --value 或从 stdin 传入）');
      writeSecret(name, value);
      print(`saved ${name}`);
      return;
    }
    case 'delete': {
      const name = positionals[2] || flags.name;
      if (!name) throw new Error('用法: js-eyes secrets delete <name>');
      deleteSecret(name);
      print(`deleted ${name}`);
      return;
    }
    default:
      throw new Error('支持的命令: `js-eyes secrets list|set|delete`');
  }
}

module.exports = { commandSecrets };
