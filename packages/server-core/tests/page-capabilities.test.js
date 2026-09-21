'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createState, _internal: { handleAutomationMessage, handleExtensionMessage, generateId } } = require('../ws-handler');
const { writeSecret } = require('@js-eyes/runtime-paths/secrets');
const { publicDownload, publicDownloadList } = require('../connectors/download-record');
const { waitForUser, resumeUserWait } = require('../user-wait');

function createMockSocket() {
  const messages = [];
  return {
    readyState: 1,
    send(data) { messages.push(JSON.parse(data)); },
    on() {},
    close() { this.readyState = 3; },
    _messages: messages,
  };
}

describe('download-record', () => {
  it('strips paths and file bodies', () => {
    const listed = publicDownloadList([{
      id: '1',
      path: '/Users/me/.js-eyes/downloads/secret.pdf',
      filename: '/tmp/secret.pdf',
      url: 'https://cdn.example.com/files/secret.pdf?token=abc',
      state: 'complete',
      bytes: 12,
      mime: 'application/pdf',
    }]);
    const json = JSON.stringify(listed);
    assert.equal(listed.downloads[0].basename, 'secret.pdf');
    assert.equal(listed.downloads[0].urlHost, 'cdn.example.com');
    assert.equal(json.includes('/Users'), false);
    assert.equal(json.includes('token=abc'), false);
    assert.equal(publicDownload({ id: '1' }).basename, '');
  });
});

describe('waitForUser', () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-pending-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('resumes from the authenticated channel', async () => {
    const state = createState();
    state.pendingUserDir = tmp;
    const pending = waitForUser(state, { reason: 'login', timeout: 5 });
    const id = [...state.pendingUsers.keys()][0];
    assert.equal(resumeUserWait(state, id), true);
    assert.deepEqual(await pending, { status: 'resumed', pendingId: id });
  });

  it('times out without page content', async () => {
    const state = createState();
    state.pendingUserDir = tmp;
    const result = await waitForUser(state, { reason: '2fa', timeout: 0.05 });
    assert.equal(result.status, 'timeout');
    assert.ok(result.pendingId);
    assert.equal(JSON.stringify(result).includes('<html'), false);
  });
});

describe('page state and secret fill', () => {
  let state;
  let autoSocket;
  let extSocket;
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'js-eyes-home-'));
    process.env.JS_EYES_HOME = tmp;
    state = createState();
    state.security = { enforcement: 'off' };
    state.requestTimeoutMs = 200;
    autoSocket = createMockSocket();
    extSocket = createMockSocket();
    const id = generateId();
    state.extensionClients.set(id, {
      socket: extSocket,
      clientAddress: '127.0.0.1:9',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      browserName: 'chrome',
      tabs: [{ id: 1, url: 'https://example.com' }],
      activeTabId: 1,
    });
    state.automationClients.set('auto-1', {
      socket: autoSocket,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    });
  });

  afterEach(() => {
    for (const info of state.pendingResponses.values()) clearTimeout(info.timeoutId);
    state.pendingResponses.clear();
    delete process.env.JS_EYES_HOME;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('forwards get_page_state and click(ref)', async () => {
    await handleAutomationMessage(
      JSON.stringify({ action: 'get_page_state', tabId: 1, requestId: 's1' }),
      'auto-1', autoSocket, state,
    );
    const forwarded = extSocket._messages[0];
    assert.equal(forwarded.type, 'get_page_state');
    await handleAutomationMessage(
      JSON.stringify({ action: 'click', tabId: 1, ref: 'e1', requestId: 'c1' }),
      'auto-1', autoSocket, state,
    );
    assert.equal(extSocket._messages[1].ref, 'e1');
  });

  it('resolves secretRef locally and never echoes the value', async () => {
    writeSecret('login-password', 'super-secret-value');
    const writes = [];
    state.audit = { write(type, payload) { writes.push({ type, payload }); } };
    await handleAutomationMessage(
      JSON.stringify({
        action: 'fill',
        tabId: 1,
        selector: '#pw',
        secretRef: 'login-password',
        requestId: 'f1',
      }),
      'auto-1', autoSocket, state,
    );
    const forwarded = extSocket._messages[0];
    assert.equal(forwarded.type, 'fill');
    assert.equal(forwarded.value, 'super-secret-value');
    assert.equal(forwarded.secretRef, undefined);
    const auditJson = JSON.stringify(writes);
    assert.equal(auditJson.includes('super-secret-value'), false);
    assert.equal(writes[0].payload.secretRef, 'login-password');
  });

  it('rejects value and secretRef together', async () => {
    await handleAutomationMessage(
      JSON.stringify({
        action: 'fill',
        tabId: 1,
        selector: '#pw',
        value: 'plain',
        secretRef: 'login-password',
        requestId: 'f2',
      }),
      'auto-1', autoSocket, state,
    );
    assert.equal(autoSocket._messages[0].code, 'INVALID_ARGUMENT');
    assert.equal(extSocket._messages.length, 0);
  });

  it('accepts resume_user from the extension', () => {
    state.pendingUserDir = path.join(tmp, 'pending');
    const pending = waitForUser(state, { reason: 'login', timeout: 5 });
    const id = [...state.pendingUsers.keys()][0];
    handleExtensionMessage(JSON.stringify({ type: 'resume_user', pendingId: id }), 'ext', state);
    return pending.then((result) => {
      assert.equal(result.status, 'resumed');
    });
  });
});
