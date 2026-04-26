#!/usr/bin/env node
'use strict';

const { main } = require('./cli/index');

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code || 0)).catch((err) => {
    process.stderr.write(`ERROR: ${err.message}\n`);
    if (process.env.JS_REDDIT_DEBUG) process.stderr.write((err.stack || '') + '\n');
    process.exit(1);
  });
}

module.exports = { main };
