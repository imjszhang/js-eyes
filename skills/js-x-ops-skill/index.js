#!/usr/bin/env node
'use strict';

/**
 * js-x-ops-skill 顶层入口（v3.0）
 *
 * 退化为 thin wrapper：所有命令派发到 cli/index.js。
 * 历史 v2 的 spawnSync 二级调度已经移除，写操作（post --reply/--post/--quote/--thread/--media/--dry-run/--confirm）
 * 由 cli/index.js 自动透传给 scripts/x-post.js。
 */

const cli = require('./cli');

if (require.main === module) {
  cli.main(process.argv.slice(2)).then((code) => process.exit(code || 0)).catch((err) => {
    process.stderr.write(`未处理的错误: ${(err && err.message) || err}\n`);
    if (err && err.stack && process.env.JS_X_DEBUG) process.stderr.write(err.stack + '\n');
    process.exit(1);
  });
}

module.exports = cli;
