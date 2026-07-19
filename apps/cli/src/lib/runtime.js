'use strict';

const fs = require('fs');
const { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT, isLoopbackHost } = require('@js-eyes/protocol');

function getServerOptions(flags, config) {
  return {
    host: flags.host || config.serverHost || DEFAULT_SERVER_HOST,
    port: Number(flags.port || config.serverPort || DEFAULT_SERVER_PORT),
  };
}

function getLoopbackOrigin(host) {
  if (!isLoopbackHost(host)) {
    return null;
  }
  if (host === '::1' || host === '[::1]') {
    return 'http://[::1]';
  }
  return `http://${host}`;
}

function isProcessAlive(pid) {
  if (!pid || Number.isNaN(Number(pid))) {
    return false;
  }

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(paths) {
  if (!fs.existsSync(paths.pidFile)) {
    return null;
  }

  const raw = fs.readFileSync(paths.pidFile, 'utf8').trim();
  const pid = Number(raw);
  return Number.isNaN(pid) ? null : pid;
}

module.exports = { getLoopbackOrigin, getServerOptions, isProcessAlive, readPid };
