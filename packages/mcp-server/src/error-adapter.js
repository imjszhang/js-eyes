'use strict';

class FacadeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FacadeError';
    this.code = code;
    this.details = details;
  }
}

function findReasonHost(reasons) {
  if (!Array.isArray(reasons)) return null;
  const item = reasons.find((reason) => reason && typeof reason.host === 'string');
  return item ? item.host : null;
}

function normalizeError(error) {
  if (error instanceof FacadeError) return error;
  const name = error && error.name;
  const message = error && error.message ? String(error.message) : String(error || 'unknown error');

  if (name === 'ServerPolicyError' || name === 'PolicyBlockError' || /^POLICY_/.test(String(error?.code || ''))) {
    const pending = error.pendingId != null;
    return new FacadeError(
      pending ? 'JS_EYES_EGRESS_PENDING' : 'JS_EYES_POLICY_BLOCKED',
      pending ? 'The destination requires JS Eyes egress approval.' : 'JS Eyes policy rejected the operation.',
      {
        rule: error.rule || null,
        reasons: Array.isArray(error.reasons) ? error.reasons : [],
        pendingId: error.pendingId || null,
        host: error.host || findReasonHost(error.reasons),
      },
    );
  }
  if (/4401|unauthori[sz]ed|auth(?:entication)? (?:failed|required)|鉴权|认证/.test(message)) {
    return new FacadeError('JS_EYES_AUTH_FAILED', 'JS Eyes server authentication failed.');
  }
  if (/no connected extension|target browser not found|没有.*扩展|未连接.*扩展|no extension/i.test(message)) {
    return new FacadeError('JS_EYES_EXTENSION_UNAVAILABLE', 'No matching JS Eyes browser extension is connected.');
  }
  if (/timed? out|timeout|超时/i.test(message)) {
    return new FacadeError('JS_EYES_REQUEST_TIMEOUT', 'The JS Eyes request timed out.');
  }
  if (/ECONNREFUSED|ENOTFOUND|WebSocket (?:创建失败|连接关闭|连接错误|发送失败)|connect/i.test(message)) {
    return new FacadeError('JS_EYES_SERVER_UNAVAILABLE', 'The JS Eyes server is unavailable.');
  }
  if (/tab.*(?:not found|不存在)|标签页.*不存在/i.test(message)) {
    return new FacadeError('JS_EYES_TAB_NOT_FOUND', 'The requested browser tab was not found.');
  }
  return new FacadeError(
    'JS_EYES_OPERATION_FAILED',
    'The JS Eyes browser operation failed.',
  );
}

function errorPayload(error) {
  const normalized = normalizeError(error);
  return {
    code: normalized.code,
    message: normalized.message,
    ...(normalized.details && Object.keys(normalized.details).length > 0
      ? { details: normalized.details }
      : {}),
  };
}

function errorResult(error) {
  const payload = errorPayload(error);
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

module.exports = { FacadeError, errorPayload, errorResult, normalizeError };
