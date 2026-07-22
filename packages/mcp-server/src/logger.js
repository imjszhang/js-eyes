'use strict';

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 100 });

function createLogger(level = 'warn', stream = process.stderr) {
  const threshold = LEVELS[level] ?? LEVELS.warn;
  function write(kind, message) {
    if ((LEVELS[kind] ?? LEVELS.info) < threshold) return;
    stream.write(`[js-eyes-mcp] ${kind}: ${String(message)}\n`);
  }
  return {
    debug(message) { write('debug', message); },
    info(message) { write('info', message); },
    warn(message) { write('warn', message); },
    error(message) { write('error', message); },
  };
}

module.exports = { LEVELS, createLogger };
