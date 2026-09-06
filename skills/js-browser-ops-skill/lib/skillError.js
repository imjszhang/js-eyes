'use strict';

const ERROR_TABLE = Object.freeze({
  invalid_params: { retryable: false },
  policy_denied: { retryable: false },
  skill_not_found: { retryable: false },
  client_not_connected: { retryable: false },
  tab_not_found: { retryable: false },
  navigation_failed: { retryable: true },
  timeout: { retryable: true },
  blocked_by_site: { retryable: true },
  rate_limited: { retryable: true, retryAfterMs: 30000 },
  csp_blocked: { retryable: false },
  eval_denied: { retryable: false },
  content_too_short: { retryable: true },
  cancelled: { retryable: false },
});

class SkillError extends Error {
  constructor(code, message, extras = {}) {
    super(message, extras.cause ? { cause: extras.cause } : undefined);
    this.name = 'SkillError';
    this.code = code;
    const meta = ERROR_TABLE[code] || { retryable: false };
    this.retryable = extras.retryable != null ? extras.retryable === true : meta.retryable === true;
    const retryAfterMs = extras.retryAfterMs != null
      ? Number(extras.retryAfterMs)
      : (code === 'rate_limited' ? Number(meta.retryAfterMs || 30000) : null);
    this.retryAfterMs = Number.isFinite(retryAfterMs) ? retryAfterMs : null;
    this.host = extras.host || extras.details?.host || null;
    this.details = extras.details && typeof extras.details === 'object' && !Array.isArray(extras.details)
      ? { ...extras.details }
      : {};
  }

  toJSON() {
    return toErrorEnvelope(this);
  }
}

function toSkillError(code, message, extras = {}) {
  if (code instanceof SkillError) return code;
  return new SkillError(code, message, extras);
}

function hostFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function isAbortError(error) {
  if (!error) return false;
  if (error.name === 'AbortError' || error.code === 'ABORT_ERR' || error.code === 'cancelled') {
    return true;
  }
  return error.name === 'TimeoutError' && error.code === 'ETIMEDOUT';
}

function abortReasonCode(signal) {
  if (!signal?.aborted) return null;
  const reason = signal.reason;
  const name = reason && reason.name;
  const message = reason && reason.message ? String(reason.message) : String(reason || '');
  if (name === 'TimeoutError' || /timed? ?out|超时/i.test(message)) return 'timeout';
  return 'cancelled';
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const code = abortReasonCode(signal) || 'cancelled';
  throw toSkillError(
    code,
    code === 'timeout' ? 'Operation timed out' : 'Operation cancelled',
    { details: { reason: signal.reason || 'aborted' } },
  );
}

function parseRetryAfterMs(error, message) {
  if (Number.isFinite(Number(error?.retryAfterMs))) return Number(error.retryAfterMs);
  if (Number.isFinite(Number(error?.retryAfter))) {
    const value = Number(error.retryAfter);
    return value > 0 && value < 1000 ? value * 1000 : value;
  }
  const match = String(message || '').match(/retry[- ]after[:\s]+(\d+)/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return value > 0 && value < 1000 ? value * 1000 : value;
}

function inferCodeFromMessage(message, code) {
  const text = String(message || '');
  if (code && ERROR_TABLE[code]) return code;
  if (/技能未找到|skill not found|is not active|技能已安装但未启用/i.test(text)) return 'skill_not_found';
  if (/no connected extension|target browser not found|没有.*扩展|未连接.*扩展|no extension|WebSocket (?:创建失败|连接关闭|连接错误|发送失败|连接超时)|ECONNREFUSED|ENOTFOUND/i.test(text)) {
    return 'client_not_connected';
  }
  if (/tab.*(?:not found|不存在)|标签页.*不存在|标签.*不存在/i.test(text)) return 'tab_not_found';
  if (/无法在标签|导航失败|navigation failed/i.test(text)) return 'navigation_failed';
  if (/429|rate.?limit|too many requests|限流/i.test(text)) return 'rate_limited';
  if (/csp|content.?security.?policy/i.test(text)) return 'csp_blocked';
  if (/allowRawEval|RAW_EVAL_DISABLED|eval_denied/i.test(text)) return 'eval_denied';
  if (/timed? ?out|超时/i.test(text)) return 'timeout';
  if (/blocked|waf|challenge|cloudflare|access denied|forbidden|\b403\b/i.test(text)) {
    return 'blocked_by_site';
  }
  if (/必须提供|cannot both be true|未知命令|未知操作|urls must/i.test(text)) return 'invalid_params';
  if (/content_too_short|正文未达|shorter than the minimum/i.test(text)) return 'content_too_short';
  return null;
}

function mapThrownError(error, extras = {}) {
  if (error instanceof SkillError) {
    if (extras.host && !error.host) error.host = extras.host;
    if (extras.details) Object.assign(error.details, extras.details);
    return error;
  }

  if (extras.signal?.aborted) {
    const code = abortReasonCode(extras.signal) || 'cancelled';
    return toSkillError(
      code,
      error?.message || (code === 'timeout' ? 'Operation timed out' : 'Operation cancelled'),
      { ...extras, details: { ...(extras.details || {}), reason: extras.signal.reason || 'aborted' } },
    );
  }

  if (isAbortError(error)) {
    if (error.name === 'TimeoutError') {
      return toSkillError('timeout', error.message || 'Operation timed out', extras);
    }
    return toSkillError('cancelled', error.message || 'Operation cancelled', extras);
  }

  const rawCode = error && error.code;
  const message = error && error.message ? String(error.message) : String(error || 'unknown error');
  const name = error && error.name;
  const host = extras.host || error?.host || error?.details?.host || null;
  const details = {
    ...(error?.details && typeof error.details === 'object' ? error.details : {}),
    ...(extras.details || {}),
  };

  if (
    rawCode === 'policy_denied'
    || name === 'PolicyDeniedError'
    || name === 'PolicyBlockError'
    || name === 'ServerPolicyError'
    || /^POLICY_/.test(String(rawCode || ''))
  ) {
    return toSkillError('policy_denied', message, {
      host,
      details: {
        ...details,
        rule: error.rule || details.rule || null,
        reasons: error.reasons || details.reasons || null,
        pendingId: error.pendingId ?? details.pendingId ?? null,
      },
    });
  }

  if (rawCode === 'tab_not_owned' || name === 'TabOwnershipError') {
    return toSkillError('tab_not_found', message, { host, details });
  }

  if (rawCode === 'eval_denied' || rawCode === 'RAW_EVAL_DISABLED' || /allowRawEval/i.test(message)) {
    return toSkillError('eval_denied', message, { host, details });
  }

  const inferred = inferCodeFromMessage(message, rawCode);
  if (inferred === 'rate_limited') {
    return toSkillError('rate_limited', message, {
      host,
      retryAfterMs: extras.retryAfterMs ?? parseRetryAfterMs(error, message) ?? 30000,
      details,
    });
  }
  if (inferred) {
    return toSkillError(inferred, message, { host, details, retryAfterMs: extras.retryAfterMs });
  }

  const fallback = extras.fallbackCode && ERROR_TABLE[extras.fallbackCode]
    ? extras.fallbackCode
    : 'invalid_params';
  return toSkillError(fallback, message, {
    host,
    details: { ...details, originalCode: rawCode || null, originalName: name || null, unmapped: true },
    retryable: extras.retryable,
  });
}

function classifyReadResult(result, extras = {}) {
  if (!result || typeof result !== 'object') return null;
  const host = extras.host || hostFromUrl(result.finalUrl || result.url);
  if (result.status === 'blocked') {
    return toSkillError('blocked_by_site', result.blockedReason
      ? `Blocked by site: ${result.blockedReason}`
      : 'Blocked by site', {
      host,
      details: { blockedReason: result.blockedReason || null, status: result.status },
    });
  }
  if (result.status === 'content_too_short') {
    return toSkillError('content_too_short', 'Page content was shorter than the minimum threshold', {
      host,
      details: {
        contentChars: result.contentChars,
        minContentChars: extras.minContentChars,
      },
    });
  }
  const text = `${result.title || ''} ${result.content || ''}`;
  if (/429|rate.?limit|too many requests|限流/i.test(text)) {
    return toSkillError('rate_limited', 'Rate limited by site', {
      host,
      retryAfterMs: extras.retryAfterMs || 30000,
      details: { source: 'page_content' },
    });
  }
  return null;
}

function toErrorPayload(error) {
  const mapped = error instanceof SkillError ? error : mapThrownError(error);
  const payload = {
    code: mapped.code,
    message: mapped.message,
    retryable: mapped.retryable === true,
  };
  if (mapped.retryAfterMs != null) payload.retryAfterMs = mapped.retryAfterMs;
  if (mapped.host) payload.host = mapped.host;
  payload.details = mapped.details && typeof mapped.details === 'object' ? mapped.details : {};
  return payload;
}

function toErrorEnvelope(error) {
  return { ok: false, error: toErrorPayload(error) };
}

function exitCodeFor(error) {
  const mapped = error instanceof SkillError ? error : mapThrownError(error);
  if (mapped.code === 'cancelled') return 130;
  if (mapped.code === 'invalid_params') return 2;
  return 1;
}

function emitCliError(error, {
  json = false,
  stdout = (...args) => console.log(...args),
  stderr = (...args) => console.error(...args),
} = {}) {
  const envelope = toErrorEnvelope(error);
  if (json) stdout(JSON.stringify(envelope));
  else stderr(envelope.error.message);
  return exitCodeFor(error);
}

function createAbortError(message = 'Aborted') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'cancelled';
  return error;
}

module.exports = {
  ERROR_TABLE,
  SkillError,
  abortReasonCode,
  classifyReadResult,
  createAbortError,
  emitCliError,
  exitCodeFor,
  hostFromUrl,
  isAbortError,
  mapThrownError,
  throwIfAborted,
  toErrorEnvelope,
  toErrorPayload,
  toSkillError,
};
