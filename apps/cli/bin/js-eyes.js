#!/usr/bin/env node

const { main } = require('../src/cli');
const { emitHostCliError } = require('../src/lib/structured-error');

main(process.argv.slice(2)).catch((error) => {
  const json = process.argv.includes('--json');
  process.exit(emitHostCliError(error, { json }));
});
