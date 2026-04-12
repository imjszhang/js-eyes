'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveDefaultBaseDir(home = os.homedir()) {
  return path.join(home, '.js-eyes');
}

function resolveLegacyBaseDir(platform = process.platform, home = os.homedir(), env = process.env) {
  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'js-eyes');
    case 'win32':
      return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'js-eyes');
    default:
      return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'js-eyes');
  }
}

function resolveBaseDir(baseDir, options = {}) {
  if (baseDir) {
    return path.resolve(baseDir);
  }

  if (process.env.JS_EYES_HOME) {
    return path.resolve(process.env.JS_EYES_HOME);
  }

  return resolveDefaultBaseDir(options.home);
}

function getPaths(options = {}) {
  const baseDir = resolveBaseDir(options.baseDir, options);
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

function readFileIfExists(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  return fs.readFileSync(file);
}

function movePath(sourcePath, targetPath) {
  const sourceStat = fs.lstatSync(sourcePath);
  if (sourceStat.isDirectory()) {
    ensureDir(targetPath);
    for (const entry of fs.readdirSync(sourcePath)) {
      movePath(path.join(sourcePath, entry), path.join(targetPath, entry));
    }
    try {
      fs.rmdirSync(sourcePath);
    } catch {}
    return;
  }

  if (!fs.existsSync(targetPath)) {
    try {
      fs.renameSync(sourcePath, targetPath);
    } catch (error) {
      if (error.code !== 'EXDEV') {
        throw error;
      }
      fs.copyFileSync(sourcePath, targetPath);
      fs.rmSync(sourcePath, { force: true });
    }
    return;
  }

  const sourceBuffer = readFileIfExists(sourcePath);
  const targetBuffer = readFileIfExists(targetPath);
  if (sourceBuffer && targetBuffer && sourceBuffer.equals(targetBuffer)) {
    fs.rmSync(sourcePath, { force: true });
  }
}

function migrateLegacyBaseDir(options = {}) {
  if (options.baseDir || process.env.JS_EYES_HOME) {
    return null;
  }

  const baseDir = resolveBaseDir(options.baseDir, options);
  const legacyBaseDir = options.legacyBaseDir
    ? path.resolve(options.legacyBaseDir)
    : resolveLegacyBaseDir(options.platform, options.home, options.env);

  if (legacyBaseDir === baseDir || !fs.existsSync(legacyBaseDir)) {
    return null;
  }

  ensureDir(baseDir);
  movePath(legacyBaseDir, baseDir);
  try {
    fs.rmdirSync(legacyBaseDir);
  } catch {}
  return legacyBaseDir;
}

function ensureRuntimePaths(options = {}) {
  migrateLegacyBaseDir(options);
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
  migrateLegacyBaseDir,
  resolveBaseDir,
  resolveDefaultBaseDir,
  resolveLegacyBaseDir,
};
