'use strict';

// openclaw-paths: OpenClaw state/config path resolution.
//
// Intentionally lives in its own module so the `process.env` reads that pick
// up OPENCLAW_CONFIG_PATH / OPENCLAW_STATE_DIR / OPENCLAW_HOME never sit in the
// same file as network clients (see SECURITY_SCAN_NOTES.md, "Environment
// variable access combined with network send"). This file MUST NOT import
// `ws`, `http`, `https`, `net`, or any network helper — that invariant is
// verified by test/import-boundaries.test.js.

const os = require('os');
const path = require('path');

function getOpenClawConfigPath(options = {}) {
  const env = options.env || process.env;
  const home = options.home || os.homedir();

  if (env.OPENCLAW_CONFIG_PATH) {
    return path.resolve(env.OPENCLAW_CONFIG_PATH);
  }
  if (env.OPENCLAW_STATE_DIR) {
    return path.resolve(env.OPENCLAW_STATE_DIR, 'openclaw.json');
  }
  if (env.OPENCLAW_HOME) {
    return path.resolve(env.OPENCLAW_HOME, '.openclaw', 'openclaw.json');
  }
  return path.join(home, '.openclaw', 'openclaw.json');
}

module.exports = {
  getOpenClawConfigPath,
};
