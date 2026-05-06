#!/usr/bin/env node
'use strict';

const { dispatch } = require('./cli');

async function main(argv = process.argv.slice(2)) {
  return dispatch(argv);
}

if (require.main === module) {
  main()
    .then((code) => process.exit(typeof code === 'number' ? code : 0))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { main };
