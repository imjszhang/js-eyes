'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function candidateTokenFiles() {
  return [
    path.join(os.homedir(), '.js-eyes', 'runtime', 'server.token'),
    path.join(os.homedir(), '.js-eyes', 'secrets', 'server-token'),
  ];
}

function readTokenFromFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const value = fs.readFileSync(filePath, 'utf8').trim();
  return value || null;
}

function resolveAutomationToken(explicitToken) {
  if (explicitToken) return explicitToken;
  if (process.env.JS_EYES_TOKEN) return process.env.JS_EYES_TOKEN;
  for (const filePath of candidateTokenFiles()) {
    try {
      const value = readTokenFromFile(filePath);
      if (value) return value;
    } catch (_) {}
  }
  return null;
}

function getWsConnectOptions() {
  return { headers: { Origin: 'http://localhost' } };
}

module.exports = {
  resolveAutomationToken,
  getWsConnectOptions,
  candidateTokenFiles,
};
