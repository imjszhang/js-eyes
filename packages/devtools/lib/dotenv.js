'use strict';

/**
 * 极简 .env 加载器：只处理 `KEY=value` 行，忽略注释与空行。
 * 不覆盖已存在的 process.env 值，保留调用方的显式配置优先级。
 */

const fs = require('fs');
const path = require('path');

const KEY_VALUE_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

function unquote(value) {
  if (!value) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function load(rootDir) {
  const file = path.join(rootDir, '.env');
  if (!fs.existsSync(file)) return {};

  const content = fs.readFileSync(file, 'utf8');
  const applied = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(KEY_VALUE_RE);
    if (!match) continue;
    const key = match[1];
    const value = unquote(match[2]);
    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied[key] = value;
    }
  }

  // 常用别名：npm_key → NPM_TOKEN, GITHUB_TOKEN → GH_TOKEN
  if (!process.env.NPM_TOKEN && process.env.npm_key) {
    process.env.NPM_TOKEN = process.env.npm_key;
  }
  if (!process.env.GH_TOKEN && process.env.GITHUB_TOKEN) {
    process.env.GH_TOKEN = process.env.GITHUB_TOKEN;
  }

  return applied;
}

module.exports = { load };
