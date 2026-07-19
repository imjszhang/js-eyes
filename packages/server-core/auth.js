'use strict';

const { URL } = require('url');
const { tokensEqual } = require('@js-eyes/runtime-paths/token');
const {
  isOriginAllowed,
} = require('@js-eyes/protocol');

const WS_SUBPROTOCOL_PREFIX = 'jse-token.';
const LEGACY_WS_SUBPROTOCOL_PREFIX = 'bearer.';
const WS_SUBPROTOCOL_PREFIXES = Object.freeze([
  WS_SUBPROTOCOL_PREFIX,
  LEGACY_WS_SUBPROTOCOL_PREFIX,
]);

function getQueryToken(requestUrl, host) {
  try {
    const url = new URL(requestUrl, `http://${host || 'localhost'}`);
    return url.searchParams.get('token');
  } catch {
    return null;
  }
}

function getBearerToken(headers) {
  if (!headers) return null;
  const value = headers['authorization'] || headers['Authorization'];
  if (!value) return null;
  const m = /^Bearer\s+(.+)$/i.exec(String(value).trim());
  return m ? m[1].trim() : null;
}

function getSubprotocolToken(headers) {
  if (!headers) return null;
  const raw = headers['sec-websocket-protocol'];
  if (!raw) return null;
  const items = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  for (const item of items) {
    for (const prefix of WS_SUBPROTOCOL_PREFIXES) {
      if (item.startsWith(prefix)) {
        return item.slice(prefix.length);
      }
    }
  }
  return null;
}

function isTokenSubprotocol(protocol) {
  return typeof protocol === 'string'
    && WS_SUBPROTOCOL_PREFIXES.some((prefix) => protocol.startsWith(prefix));
}

function extractToken({ headers, url, host }) {
  return (
    getBearerToken(headers)
    || getSubprotocolToken(headers)
    || getQueryToken(url, host)
  );
}

function checkAccess(options) {
  const {
    token,
    headers,
    url,
    host,
    origin,
    security,
    requireToken = true,
  } = options;

  const presentedToken = extractToken({ headers, url, host });
  const tokenOk = !requireToken || (token && presentedToken && tokensEqual(token, presentedToken));
  const originOk = isOriginAllowed(origin, security.allowedOrigins);

  if (tokenOk && originOk) {
    return { allowed: true, reason: null, anonymous: false };
  }

  const reasons = [];
  if (!tokenOk) reasons.push('token');
  if (!originOk) reasons.push('origin');

  if (security.allowAnonymous) {
    return {
      allowed: true,
      anonymous: true,
      reason: reasons.join('+') || 'anonymous',
    };
  }

  return {
    allowed: false,
    anonymous: false,
    reason: reasons.join('+') || 'unauthorized',
  };
}

module.exports = {
  WS_SUBPROTOCOL_PREFIX,
  LEGACY_WS_SUBPROTOCOL_PREFIX,
  WS_SUBPROTOCOL_PREFIXES,
  checkAccess,
  extractToken,
  getBearerToken,
  getQueryToken,
  getSubprotocolToken,
  isTokenSubprotocol,
};
