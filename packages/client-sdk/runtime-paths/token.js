'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  ensureDir,
  ensureSecretFilePermissions,
  getPaths,
  writeSecretFile,
} = require('./index');

const MIN_TOKEN_LENGTH = 32;

function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function getTokenFilePath(options = {}) {
  if (options.tokenFile) {
    return path.resolve(options.tokenFile);
  }
  return getPaths(options).tokenFile;
}

function readToken(options = {}) {
  const filePath = getTokenFilePath(options);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  ensureSecretFilePermissions(filePath, { mode: 0o600 });
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw || null;
}

function writeToken(token, options = {}) {
  if (!token || typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH / 2) {
    throw new Error('拒绝写入弱 token');
  }
  const filePath = getTokenFilePath(options);
  ensureDir(path.dirname(filePath));
  writeSecretFile(filePath, token + '\n', { mode: 0o600 });
  return filePath;
}

function ensureToken(options = {}) {
  const existing = readToken(options);
  if (existing) {
    return { token: existing, created: false, path: getTokenFilePath(options) };
  }
  const token = generateToken();
  const filePath = writeToken(token, options);
  return { token, created: true, path: filePath };
}

function rotateToken(options = {}) {
  const token = generateToken();
  const filePath = writeToken(token, options);
  return { token, path: filePath };
}

function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  MIN_TOKEN_LENGTH,
  ensureToken,
  generateToken,
  getTokenFilePath,
  readToken,
  rotateToken,
  tokensEqual,
  writeToken,
};
