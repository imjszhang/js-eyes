#!/usr/bin/env node
'use strict';

/**
 * 顶层入口：直接委托给 cli/index.js 的 dispatcher。
 * 老 v2.0.1 行为（spawn scripts/xhs-note.js）保留：
 *   JS_XHS_DISABLE_BRIDGE=1 node index.js note <url>  → cli/index.js 内会判定并走老路径。
 */

const { dispatch } = require('./cli');

async function main(argv) {
  return dispatch(argv || process.argv.slice(2));
}

if (require.main === module) {
  main()
    .then((code) => process.exit(typeof code === 'number' ? code : 0))
    .catch((err) => {
      process.stderr.write(`Fatal: ${err && err.message}\n`);
      process.exit(1);
    });
}

module.exports = { main };
