'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, getPaths, writeSecretFile } = require('./index');

const SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;

function assertSecretName(name) {
  const normalized = String(name || '').trim();
  if (!SECRET_NAME_RE.test(normalized)) {
    const error = /** @type {Error & { code?: string }} */ (new Error('Invalid secret name'));
    error.code = 'INVALID_SECRET_NAME';
    throw error;
  }
  return normalized;
}

function resolveSecretPath(name, options = {}) {
  const safe = assertSecretName(name);
  return path.join(getPaths(options).secretsDir, safe);
}

function readSecret(name, options = {}) {
  const filePath = resolveSecretPath(name, options);
  if (!fs.existsSync(filePath)) {
    const error = /** @type {Error & { code?: string }} */ (new Error(`Secret not found: ${name}`));
    error.code = 'SECRET_NOT_FOUND';
    throw error;
  }
  return fs.readFileSync(filePath, 'utf8').replace(/\n$/, '');
}

function writeSecret(name, value, options = {}) {
  const filePath = resolveSecretPath(name, options);
  writeSecretFile(filePath, String(value == null ? '' : value));
  return filePath;
}

function deleteSecret(name, options = {}) {
  const filePath = resolveSecretPath(name, options);
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
  return true;
}

function listSecretNames(options = {}) {
  const dir = getPaths(options).secretsDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((entry) => SECRET_NAME_RE.test(entry));
}

function ensureSecretsDir(options = {}) {
  const dir = getPaths(options).secretsDir;
  ensureDir(dir);
  return dir;
}

module.exports = {
  SECRET_NAME_RE,
  assertSecretName,
  deleteSecret,
  ensureSecretsDir,
  listSecretNames,
  readSecret,
  resolveSecretPath,
  writeSecret,
};
