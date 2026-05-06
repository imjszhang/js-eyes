'use strict';

const os = require('os');
const path = require('path');

function resolvePaths() {
  const base = process.env.JS_ZHIHU_MONITOR_HOME
    || path.join(os.homedir(), '.js-eyes', 'skill-data', 'js-zhihu-ops-skill', 'monitor');
  return {
    base,
    configFile: path.join(base, 'config.json'),
    stateDir: path.join(base, 'state'),
    logsDir: path.join(base, 'logs'),
  };
}

module.exports = { resolvePaths };
