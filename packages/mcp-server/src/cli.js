'use strict';

const pkg = require('../package.json');
const { parseArgv, resolveConfig } = require('./config');
const { startStdioServer } = require('./server');

const HELP = `JS Eyes native MCP server

Usage: js-eyes-mcp [options]

Options:
  --server-url <url>       Existing JS Eyes WebSocket server
  --target <id|name>       Default extension clientId or browser name
  --tool-profile <profile> safe (default) or full
  --connect-timeout <sec>  Connection/status timeout
  --request-timeout <sec>  Browser operation timeout
  --log-level <level>      debug, info, warn, error, or silent
  --help                   Show this help
  --version                Show package version
`;

async function main(options = {}) {
  const argv = parseArgv(options.argv || process.argv.slice(2));
  const stdout = options.stdout || process.stdout;
  if (argv.help) {
    stdout.write(HELP);
    return null;
  }
  if (argv.version) {
    stdout.write(`${pkg.version}\n`);
    return null;
  }
  const config = resolveConfig({ argv, env: options.env, runtimeConfig: options.runtimeConfig });
  const instance = await startStdioServer(config, options);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await instance.close();
  };
  if (options.installSignalHandlers !== false) {
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    process.stdin.once('end', close);
  }
  return { ...instance, close };
}

module.exports = { HELP, main };
