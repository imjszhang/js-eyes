'use strict';

function inferCliErrorCode(error) {
  const code = error && error.code;
  const message = error && error.message ? String(error.message) : String(error || '');
  if (code === 'skill_not_found' || /技能未找到|skill not found|is not active|技能已安装但未启用/i.test(message)) {
    return 'skill_not_found';
  }
  if (code === 'cancelled') return 'cancelled';
  if (code === 'invalid_params') return 'invalid_params';
  if (typeof code === 'string' && code && !/^POLICY_/.test(code) && code !== 'SKILL_RUNTIME_ERROR') {
    return code;
  }
  return 'invalid_params';
}

function toCliErrorEnvelope(error) {
  const code = inferCliErrorCode(error);
  return {
    ok: false,
    error: {
      code,
      message: error && error.message ? String(error.message) : String(error || 'unknown error'),
      retryable: error?.retryable === true,
      retryAfterMs: error?.retryAfterMs ?? (code === 'rate_limited' ? 30000 : null),
      host: error?.host || null,
      details: error?.details && typeof error.details === 'object' ? error.details : {},
    },
  };
}

function emitHostCliError(error, {
  json = false,
  stdout = (...args) => console.log(...args),
  stderr = (...args) => console.error(...args),
} = {}) {
  const envelope = toCliErrorEnvelope(error);
  if (json) stdout(JSON.stringify(envelope));
  else stderr(envelope.error.message);
  if (envelope.error.code === 'cancelled') return 130;
  if (envelope.error.code === 'invalid_params') return 2;
  return 1;
}

module.exports = {
  emitHostCliError,
  inferCliErrorCode,
  toCliErrorEnvelope,
};
