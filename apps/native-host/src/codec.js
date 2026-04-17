'use strict';

const MAX_MESSAGE_BYTES = 1024 * 1024;

function encodeMessage(payload) {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8');
  if (body.length > MAX_MESSAGE_BYTES) {
    throw new Error(`native-host message exceeds ${MAX_MESSAGE_BYTES} bytes`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function createFrameReader({ onMessage, onError }) {
  let buffer = Buffer.alloc(0);
  let needBody = false;
  let expected = 0;

  return function feed(chunk) {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

    while (true) {
      if (!needBody) {
        if (buffer.length < 4) return;
        expected = buffer.readUInt32LE(0);
        if (expected > MAX_MESSAGE_BYTES) {
          onError?.(new Error(`frame too large: ${expected}`));
          buffer = Buffer.alloc(0);
          return;
        }
        buffer = buffer.slice(4);
        needBody = true;
      }

      if (buffer.length < expected) return;
      const body = buffer.slice(0, expected);
      buffer = buffer.slice(expected);
      needBody = false;
      expected = 0;

      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch (error) {
        onError?.(error);
        continue;
      }
      onMessage?.(parsed);
    }
  };
}

module.exports = {
  MAX_MESSAGE_BYTES,
  encodeMessage,
  createFrameReader,
};
