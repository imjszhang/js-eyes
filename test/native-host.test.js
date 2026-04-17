'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { encodeMessage, createFrameReader, MAX_MESSAGE_BYTES } = require('../apps/native-host/src/codec');

describe('native-host codec', () => {
  it('encodes JSON with 4-byte little-endian length header', () => {
    const encoded = encodeMessage({ ok: true });
    const expectedBody = Buffer.from(JSON.stringify({ ok: true }));
    assert.equal(encoded.readUInt32LE(0), expectedBody.length);
    assert.deepEqual(encoded.slice(4), expectedBody);
  });

  it('roundtrips single message', () => {
    const messages = [];
    const feed = createFrameReader({ onMessage: (m) => messages.push(m) });
    feed(encodeMessage({ type: 'ping' }));
    assert.deepEqual(messages, [{ type: 'ping' }]);
  });

  it('roundtrips multiple messages in one chunk', () => {
    const messages = [];
    const feed = createFrameReader({ onMessage: (m) => messages.push(m) });
    const buf = Buffer.concat([
      encodeMessage({ type: 'ping' }),
      encodeMessage({ type: 'get-config' }),
    ]);
    feed(buf);
    assert.deepEqual(messages, [{ type: 'ping' }, { type: 'get-config' }]);
  });

  it('handles a message split across chunks', () => {
    const messages = [];
    const feed = createFrameReader({ onMessage: (m) => messages.push(m) });
    const full = encodeMessage({ type: 'get-config' });
    feed(full.slice(0, 2));
    feed(full.slice(2, 6));
    feed(full.slice(6));
    assert.deepEqual(messages, [{ type: 'get-config' }]);
  });

  it('emits decode error for bad JSON body', () => {
    const errors = [];
    const feed = createFrameReader({
      onMessage: () => {},
      onError: (e) => errors.push(e),
    });
    const body = Buffer.from('not-json');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    feed(Buffer.concat([header, body]));
    assert.equal(errors.length, 1);
  });

  it('rejects frames larger than MAX_MESSAGE_BYTES', () => {
    const errors = [];
    const feed = createFrameReader({
      onMessage: () => {},
      onError: (e) => errors.push(e),
    });
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_MESSAGE_BYTES + 1, 0);
    feed(header);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /frame too large/);
  });
});

describe('native-host handleMessage', () => {
  const { handleMessage } = require('../apps/native-host/src/host');

  it('returns pong for ping', () => {
    const reply = handleMessage({ type: 'ping' });
    assert.equal(reply.ok, true);
    assert.equal(reply.type, 'pong');
    assert.equal(typeof reply.version, 'string');
  });

  it('returns unknown-type for unrecognized messages', () => {
    const reply = handleMessage({ type: 'not-a-thing' });
    assert.equal(reply.ok, false);
    assert.equal(reply.error, 'unknown-type');
  });

  it('returns token-missing when env lacks token', () => {
    const saved = process.env.JS_EYES_SERVER_TOKEN;
    const savedHome = process.env.JS_EYES_HOME;
    try {
      delete process.env.JS_EYES_SERVER_TOKEN;
      const tmp = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'jseyes-nh-'));
      process.env.JS_EYES_HOME = tmp;
      const reply = handleMessage({ type: 'get-config' });
      assert.equal(reply.ok, false);
      assert.equal(reply.error, 'token-missing');
      assert.equal(typeof reply.serverUrl, 'string');
    } finally {
      if (saved) process.env.JS_EYES_SERVER_TOKEN = saved;
      if (savedHome) process.env.JS_EYES_HOME = savedHome; else delete process.env.JS_EYES_HOME;
    }
  });

  it('returns token when env provides it', () => {
    const saved = process.env.JS_EYES_SERVER_TOKEN;
    try {
      process.env.JS_EYES_SERVER_TOKEN = 'test-token-12345678901234567890abcdef';
      const reply = handleMessage({ type: 'get-config' });
      assert.equal(reply.ok, true);
      assert.equal(reply.serverToken, 'test-token-12345678901234567890abcdef');
    } finally {
      if (saved) process.env.JS_EYES_SERVER_TOKEN = saved; else delete process.env.JS_EYES_SERVER_TOKEN;
    }
  });
});
