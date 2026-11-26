'use strict';

const WebSocket = require('ws');

function waitForOpen(socket, timeoutMs = 30000, waitingMessage = 'Waiting for browser connection') {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${waitingMessage} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const onOpen = () => {
      cleanup();
      resolve(undefined);
    };
    const onError = (err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const onClose = () => {
      cleanup();
      reject(new Error('WebSocket closed before the connector handshake finished'));
    };
    function cleanup() {
      clearTimeout(timer);
      socket.off('open', onOpen);
      socket.off('error', onError);
      socket.off('close', onClose);
    }
    socket.on('open', onOpen);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

class JsonRpcSocket {
  constructor(ws, options = {}) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onEvent = options.onEvent || (() => {});
    this.ws.on('message', (raw) => this._onMessage(raw));
    this.ws.on('close', () => this._onClose(new Error('WebSocket closed')));
    this.ws.on('error', (err) => this._onClose(err));
  }

  get connected() {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  send(method, params = {}, extra = {}) {
    if (!this.connected) {
      return Promise.reject(new Error('Connector socket is not connected'));
    }
    const id = this.nextId++;
    const payload = { id, method, params, ...extra };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    this.closed = true;
    try { this.ws.close(); } catch { /* ignore */ }
    this._onClose(new Error('Connector socket closed'));
  }

  _onMessage(raw) {
    let data;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (data.id != null && this.pending.has(data.id)) {
      const pending = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.error) {
        const err = /** @type {Error & { code?: * }} */ (new Error(data.error.message || 'Connector RPC error'));
        err.code = data.error.code;
        pending.reject(err);
        return;
      }
      pending.resolve(data.result);
      return;
    }
    if (data.method) this.onEvent(data);
  }

  _onClose(err) {
    this.closed = true;
    for (const [, pending] of this.pending) {
      pending.reject(err instanceof Error ? err : new Error(String(err)));
    }
    this.pending.clear();
  }
}

module.exports = { JsonRpcSocket, waitForOpen };
