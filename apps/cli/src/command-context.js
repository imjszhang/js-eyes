'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createServer } = require('@js-eyes/server-core');
const { loadConfig, getConfigValue, parseConfigValue, setConfigValue } = require('@js-eyes/config');
const {
  chmodBestEffort,
  ensureRuntimePaths,
  getPaths,
  resolveSkillRecordsDir,
} = require('@js-eyes/runtime-paths');
const {
  ensureToken,
  readToken,
  rotateToken,
  getTokenFilePath,
} = require('@js-eyes/runtime-paths/token');
const {
  COMPATIBILITY_MATRIX,
  POLICY_ENFORCEMENT_LEVELS,
  PROTOCOL_VERSION,
  RELEASE_BASE_URL,
  isLoopbackHost,
  resolveSecurityConfig,
} = require('@js-eyes/protocol');
const {
  NATIVE_HOST_NAME,
  installBrowsers: installNativeHostBrowsers,
  resolveHostScriptPath: resolveNativeHostScript,
  statusBrowsers: statusNativeHostBrowsers,
  uninstallBrowsers: uninstallNativeHostBrowsers,
} = require('@js-eyes/native-host');
const {
  applySkillInstall,
  cleanupStaging,
  discoverLocalSkills,
  discoverSkillsFromSources,
  fetchSkillsRegistry,
  getLegacyOpenClawSkillState,
  isSkillEnabled,
  planSkillInstall,
  readSkillById,
  readSkillByIdFromSources,
  resolveSkillSources,
  resolveSkillsDir,
  runSkillCli,
  skillToolActionName,
  verifySkillIntegrity,
} = require('@js-eyes/protocol/skills');
const {
  snapshotExtraDir,
  clearSnapshotForExtraDir,
  classifyExtraDir,
} = require('@js-eyes/protocol/extra-integrity');
const { flagsToArgv } = require('./lib/args');
const { print } = require('./lib/output');
const { resolvePluginPath: resolvePluginPathFromLib } = require('./lib/plugin');
const { getLoopbackOrigin, getServerOptions, isProcessAlive, readPid } = require('./lib/runtime');
const { compareSemver } = require('./lib/semver');
const pkg = require('../package.json');

function resolveSources(paths, config) {
  return resolveSkillSources({
    primary: resolveSkillsDir(paths, config),
    extras: Array.isArray(config && config.extraSkillDirs) ? config.extraSkillDirs : [],
  });
}

function skillActions(skill) {
  if (Array.isArray(skill && skill.actions)) return skill.actions.slice();
  const tools = Array.isArray(skill && skill.tools) ? skill.tools : [];
  return tools.map((tool) => skillToolActionName(skill.id, tool));
}

async function fetchJson(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (!headers.Origin && options.host) {
    const origin = getLoopbackOrigin(options.host);
    if (origin) {
      headers.Origin = origin;
    }
  }
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function readServerToken() {
  if (process.env.JS_EYES_SERVER_TOKEN) return process.env.JS_EYES_SERVER_TOKEN;
  return readToken();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolvePluginPath() {
  return resolvePluginPathFromLib({ cliDir: __dirname });
}

module.exports = {
  COMPATIBILITY_MATRIX,
  NATIVE_HOST_NAME,
  POLICY_ENFORCEMENT_LEVELS,
  PROTOCOL_VERSION,
  RELEASE_BASE_URL,
  applySkillInstall,
  chmodBestEffort,
  classifyExtraDir,
  cleanupStaging,
  clearSnapshotForExtraDir,
  compareSemver,
  createServer,
  discoverLocalSkills,
  discoverSkillsFromSources,
  ensureRuntimePaths,
  ensureToken,
  fetchJson,
  fetchSkillsRegistry,
  flagsToArgv,
  fs,
  getConfigValue,
  getLegacyOpenClawSkillState,
  getPaths,
  getServerOptions,
  getTokenFilePath,
  installNativeHostBrowsers,
  isLoopbackHost,
  isProcessAlive,
  isSkillEnabled,
  loadConfig,
  parseConfigValue,
  path,
  pkg,
  planSkillInstall,
  print,
  readJson,
  readPid,
  readServerToken,
  readSkillById,
  readSkillByIdFromSources,
  readToken,
  resolveNativeHostScript,
  resolvePluginPath,
  resolveSecurityConfig,
  resolveSkillRecordsDir,
  resolveSources,
  rotateToken,
  runSkillCli,
  setConfigValue,
  skillActions,
  skillToolActionName,
  snapshotExtraDir,
  spawn,
  statusNativeHostBrowsers,
  uninstallNativeHostBrowsers,
  verifySkillIntegrity,
};
