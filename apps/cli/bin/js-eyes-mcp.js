#!/usr/bin/env node
'use strict';

const { main } = require('../mcp-server/src/cli');

main().catch((error) => {
  process.stderr.write(`[js-eyes-mcp] fatal: ${error.message}\n`);
  process.exitCode = 1;
});
