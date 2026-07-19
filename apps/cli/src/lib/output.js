'use strict';

function print(message = '') {
  process.stdout.write(String(message) + '\n');
}

module.exports = { print };
