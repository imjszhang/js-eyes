'use strict';

const fs = require('fs');
const path = require('path');

function resolvePluginPath(options = {}) {
  const configuredPath = process.env.JS_EYES_PLUGIN_DIR
    ? path.resolve(process.env.JS_EYES_PLUGIN_DIR)
    : null;
  const cliDir = options.cliDir || path.resolve(__dirname, '..');
  const repoRoot = path.resolve(cliDir, '..', '..', '..');
  const candidates = [
    configuredPath,
    path.join(repoRoot, 'openclaw-plugin'),
    path.join(process.cwd(), 'openclaw-plugin'),
  ].filter(Boolean);

  const pluginDir = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'openclaw.plugin.json')));
  if (!pluginDir) {
    throw new Error('未找到 `openclaw-plugin` 组件目录');
  }
  return pluginDir;
}

module.exports = { resolvePluginPath };
