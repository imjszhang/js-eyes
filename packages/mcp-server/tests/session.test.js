'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { BrowserSession } = require('../src/browser-session');

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const config = {
  serverUrl: 'ws://localhost:18080',
  requestTimeout: 30,
  connectTimeout: 5,
  toolProfile: 'safe',
  target: null,
};

function sessionWith(clients) {
  const bot = {
    async ensureConnected() {},
    async listClients() { return clients; },
    disconnect() {},
  };
  return new BrowserSession(config, {
    logger: silentLogger,
    automationFactory: () => bot,
  });
}

describe('BrowserSession target resolution', () => {
  it('selects the sole connected extension', async () => {
    const session = sessionWith([{ clientId: 'ext-1', browserName: 'chrome' }]);
    assert.equal(await session.resolveTarget(), 'ext-1');
  });

  it('prefers exact clientId and accepts a unique browser name', async () => {
    const session = sessionWith([
      { clientId: 'ext-c', browserName: 'chrome' },
      { clientId: 'ext-f', browserName: 'firefox' },
    ]);
    assert.equal(await session.resolveTarget('ext-f'), 'ext-f');
    assert.equal(await session.resolveTarget('chrome'), 'ext-c');
  });

  it('requires a target when several extensions are connected', async () => {
    const session = sessionWith([
      { clientId: 'ext-1', browserName: 'chrome' },
      { clientId: 'ext-2', browserName: 'firefox' },
    ]);
    await assert.rejects(
      () => session.resolveTarget(),
      (error) => error.code === 'JS_EYES_TARGET_REQUIRED',
    );
  });
});
