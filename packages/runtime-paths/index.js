'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveBaseDir(baseDir) {
  if (baseDir) {
    return path.resolve(baseDir);
  }

  if (process.env.JS_EYES_HOME) {
    return path.resolve(process.env.JS_EYES_HOME);
  }

  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'js-eyes');
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'js-eyes');
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'js-eyes');
  }
}

function getPaths(options = {}) {
  const baseDir = resolveBaseDir(options.baseDir);
  return {
    baseDir,
    configDir: path.join(baseDir, 'config'),
    configFile: path.join(baseDir, 'config', 'config.json'),
    skillsDir: path.join(baseDir, 'skills'),
    runtimeDir: path.join(baseDir, 'runtime'),
    pidFile: path.join(baseDir, 'runtime', 'server.pid'),
    logsDir: path.join(baseDir, 'logs'),
    serverLogFile: path.join(baseDir, 'logs', 'server.log'),
    cacheDir: path.join(baseDir, 'cache'),
    downloadsDir: path.join(baseDir, 'downloads'),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureRuntimePaths(options = {}) {
  const paths = getPaths(options);
  ensureDir(paths.baseDir);
  ensureDir(paths.configDir);
  ensureDir(paths.skillsDir);
  ensureDir(paths.runtimeDir);
  ensureDir(paths.logsDir);
  ensureDir(paths.cacheDir);
  ensureDir(paths.downloadsDir);
  return paths;
}

module.exports = {
  ensureDir,
  ensureRuntimePaths,
  getPaths,
  resolveBaseDir,
};
