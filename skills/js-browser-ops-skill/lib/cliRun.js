'use strict';

const { emitCliError } = require('./skillError');
const { installCliAbort } = require('./cliAbort');

function wantsJson(argv = process.argv) {
  return argv.includes('--json');
}

async function runCliCommand(mainFn, options = {}) {
  const json = options.json != null ? options.json : wantsJson(process.argv);
  const abort = installCliAbort();
  try {
    await mainFn({ signal: abort.signal, json });
  } catch (error) {
    const code = emitCliError(error, { json });
    process.exitCode = code;
    if (options.exit !== false) process.exit(code);
  } finally {
    abort.dispose();
  }
}

module.exports = { runCliCommand, wantsJson };
