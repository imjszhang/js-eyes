'use strict';

async function commandMcp(argv) {
  const { runMcpCli } = require('../../mcp-server');
  await runMcpCli({ argv });
}

module.exports = { commandMcp };
