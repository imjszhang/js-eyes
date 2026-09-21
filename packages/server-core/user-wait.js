'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chmodBestEffort, ensureDir, getPaths, writeSecretFile } = require('@js-eyes/runtime-paths');

function pendingDir(state) {
  const dir = state.pendingUserDir || getPaths().pendingUserDir;
  ensureDir(dir);
  return dir;
}

function writeRecord(state, record) {
  const filePath = path.join(pendingDir(state), `${record.id}.json`);
  writeSecretFile(filePath, JSON.stringify(record, null, 2) + '\n');
  chmodBestEffort(filePath, 0o600);
  return filePath;
}

function listPendingUsers(state) {
  const dir = pendingDir(state);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      return null;
    }
  }).filter((item) => item && item.status === 'pending');
}

function notifyBrowserClients(state, message) {
  const clients = state.browserClients || state.extensionClients;
  if (!clients) return;
  for (const conn of clients.values()) {
    if ((conn.kind || 'extension') !== 'extension') continue;
    if (conn.socket && conn.socket.readyState === 1) {
      try { conn.socket.send(JSON.stringify(message)); } catch { /* ignore */ }
    }
  }
}

function resumeUserWait(state, pendingId) {
  const id = String(pendingId || '').trim();
  if (!id) return false;
  const pending = state.pendingUsers && state.pendingUsers.get(id);
  if (!pending) return false;
  clearTimeout(pending.timer);
  state.pendingUsers.delete(id);
  pending.record.status = 'resumed';
  pending.record.resumedAt = new Date().toISOString();
  writeRecord(state, pending.record);
  pending.resolve({ status: 'resumed', pendingId: id });
  notifyBrowserClients(state, { type: 'pending_user_cleared', pendingId: id });
  return true;
}

function waitForUser(state, input = {}) {
  const reason = String(input.reason || '').trim();
  if (!reason) {
    const error = /** @type {Error & { code?: string }} */ (new Error('reason is required'));
    error.code = 'INVALID_ARGUMENT';
    throw error;
  }
  const timeoutSec = Number.isFinite(Number(input.timeout)) ? Number(input.timeout) : 300;
  const timeoutMs = Math.max(50, Math.min(1800, timeoutSec) * 1000);
  const id = crypto.randomUUID();
  const record = {
    id,
    status: 'pending',
    reason,
    tabId: input.tabId ?? null,
    createdAt: new Date().toISOString(),
  };
  writeRecord(state, record);
  if (!state.pendingUsers) state.pendingUsers = new Map();

  notifyBrowserClients(state, {
    type: 'pending_user',
    pendingId: id,
    reason,
    tabId: record.tabId,
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.pendingUsers.delete(id);
      record.status = 'timeout';
      record.timedOutAt = new Date().toISOString();
      writeRecord(state, record);
      notifyBrowserClients(state, { type: 'pending_user_cleared', pendingId: id });
      resolve({ status: 'timeout', pendingId: id });
    }, timeoutMs);
    state.pendingUsers.set(id, { resolve, timer, record });
  });
}

module.exports = {
  listPendingUsers,
  resumeUserWait,
  waitForUser,
};
