#!/usr/bin/env node
'use strict';

const { main } = require('../cli/index');

async function run() {
  if (!process.env.JS_GOOGLE_SMOKE) {
    process.stderr.write('smoke-browser: set JS_GOOGLE_SMOKE=1 to run live Google checks (requires js-eyes server + extension)\n');
    process.exit(0);
  }
  const cases = [
    ['search', 'nodejs', '--limit', '3', '--pretty'],
    ['news', 'openai', '--limit', '3', '--time-range', 'w'],
    ['images', 'cat', '--limit', '3'],
    ['scholar', 'attention is all you need', '--limit', '3'],
  ];
  for (const argv of cases) {
    process.stderr.write(`smoke: ${argv.join(' ')}\n`);
    const code = await main(argv);
    if (code !== 0) {
      process.stderr.write(`smoke failed: ${argv[0]} exit ${code}\n`);
      process.exit(code || 1);
    }
  }
}

run().catch((err) => {
  process.stderr.write(`smoke-browser: ${err.message}\n`);
  process.exit(1);
});
