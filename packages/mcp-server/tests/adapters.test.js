'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { ServerPolicyError } = require('@js-eyes/client-sdk');
const { FacadeError, errorResult, normalizeError } = require('../src/error-adapter');
const { parseDataUrl, screenshotResult, truncate } = require('../src/result-adapter');

describe('MCP result adapters', () => {
  it('turns data URLs into native image content', () => {
    const result = screenshotResult({
      tabId: 3,
      format: 'png',
      dataUrl: 'data:image/png;base64,YWJj',
      segments: [],
      fullPage: false,
    });
    assert.equal(result.content[1].type, 'image');
    assert.equal(result.content[1].mimeType, 'image/png');
    assert.equal(result.content[1].data, 'YWJj');
    assert.equal(result.structuredContent.imageCount, 1);
    assert.equal(JSON.stringify(result.structuredContent).includes('YWJj'), false);
  });

  it('rejects non-base64 data URLs and truncates text', () => {
    assert.equal(parseDataUrl('https://example.com/a.png'), null);
    assert.deepEqual(truncate('abcdef', 3), {
      text: 'abc\n\n[truncated by js-eyes-mcp]',
      truncated: true,
      originalLength: 6,
    });
  });
});

describe('MCP error adapters', () => {
  it('preserves policy approval details', () => {
    const error = new ServerPolicyError('blocked', {
      code: 'POLICY_PENDING_EGRESS',
      rule: 'L5-egress',
      reasons: [{ host: 'example.com' }],
      pendingId: 'pending-1',
    });
    const normalized = normalizeError(error);
    assert.equal(normalized.code, 'JS_EYES_EGRESS_PENDING');
    assert.equal(normalized.details.pendingId, 'pending-1');
    assert.equal(normalized.details.host, 'example.com');
  });

  it('returns tool-level errors without leaking the original secret message', () => {
    const result = errorResult(new Error('upstream failed with token super-secret-token'));
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'JS_EYES_OPERATION_FAILED');
    assert.equal(JSON.stringify(result).includes('super-secret-token'), false);
  });
});
