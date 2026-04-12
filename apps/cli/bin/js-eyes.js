#!/usr/bin/env node

const { main } = require('../src/cli');

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
