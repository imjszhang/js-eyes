'use strict';

function readCookieValue(raw) {
  if (!raw || typeof raw !== 'object') return '';
  if (typeof raw.value === 'string') return raw.value;
  if (raw.value && typeof raw.value === 'object' && typeof raw.value.value === 'string') {
    return raw.value.value;
  }
  return '';
}

function readExpiresSeconds(raw) {
  if (!raw || raw.session === true) return null;
  const candidates = [raw.expires, raw.expiry, raw.expirationDate];
  for (const value of candidates) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  return null;
}

function normalizeSameSite(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).toLowerCase();
  if (normalized === 'strict') return 'strict';
  if (normalized === 'lax') return 'lax';
  if (normalized === 'none' || normalized === 'no_restriction') return 'none';
  if (normalized === 'unspecified' || normalized === 'default') return 'unspecified';
  return 'unknown';
}

function normalizeDomain(domain) {
  if (typeof domain !== 'string') return '';
  return domain.trim();
}

function toCanonicalCookie(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      name: '',
      value: '',
      domain: '',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: null,
      session: true,
      expires: null,
      hostOnly: false,
    };
  }
  const expires = readExpiresSeconds(raw);
  const domain = normalizeDomain(raw.domain);
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    value: readCookieValue(raw),
    domain,
    path: typeof raw.path === 'string' && raw.path ? raw.path : '/',
    secure: raw.secure === true,
    httpOnly: raw.httpOnly === true,
    sameSite: normalizeSameSite(raw.sameSite),
    session: raw.session === true || expires == null,
    expires,
    hostOnly: raw.hostOnly === true || (domain !== '' && !domain.startsWith('.')),
  };
}

function cookieIdentity(cookie) {
  const domain = String(cookie && cookie.domain || '').replace(/^\./, '').toLowerCase();
  const path = cookie && cookie.path ? cookie.path : '/';
  const name = cookie && cookie.name ? cookie.name : '';
  return `${name}\0${domain}\0${path}`;
}

function skipCookieReason(cookie, raw = cookie) {
  const source = raw && typeof raw === 'object' ? raw : {};
  if (source.partitionKey || source.partition || source.partitioned) {
    return 'chips-partition';
  }
  const storeId = source.storeId;
  if (storeId != null && storeId !== '' && storeId !== 0 && storeId !== '0' && storeId !== 'default') {
    return 'unknown-store';
  }
  if (!cookie || !cookie.name) return 'invalid';
  if (cookie.value == null) return 'invalid';
  if (cookie.sameSite === 'unknown') return 'unknown-samesite';
  if (cookie.sameSite === 'none' && !cookie.secure) return 'samesite-none';
  if (cookie.name.startsWith('__Host-')) {
    if (!cookie.secure) return 'host-prefix';
    if (cookie.path && cookie.path !== '/') return 'host-prefix';
    if (cookie.domain && cookie.domain.startsWith('.')) return 'host-prefix';
    if (source.hostOnly === false && cookie.domain) return 'host-prefix';
  }
  if (cookie.name.startsWith('__Secure-') && !cookie.secure) return 'secure-prefix';
  if (!cookie.session && cookie.expires != null && cookie.expires * 1000 <= Date.now()) {
    return 'expired';
  }
  if (!cookie.domain) return 'missing-domain';
  return null;
}

function classifyCookies(list) {
  const cookies = [];
  const reasons = [];
  let skipped = 0;
  for (const raw of Array.isArray(list) ? list : []) {
    const cookie = toCanonicalCookie(raw);
    const reason = skipCookieReason(cookie, raw);
    if (reason) {
      skipped += 1;
      reasons.push({ name: cookie.name || null, reason });
      continue;
    }
    cookies.push(cookie);
  }
  return { cookies, skipped, reasons };
}

function cookieMatchesDomain(cookie, domain, includeSubdomains = true) {
  const host = String(cookie && cookie.domain || '').replace(/^\./, '').toLowerCase();
  const target = String(domain || '').replace(/^\./, '').toLowerCase();
  if (!host || !target) return false;
  if (host === target) return true;
  if (includeSubdomains === false) return false;
  return host.endsWith(`.${target}`);
}

function cookieUrl(cookie) {
  const host = String(cookie && cookie.domain || '').replace(/^\./, '');
  if (!host) return null;
  const scheme = cookie.secure ? 'https' : 'http';
  const path = cookie.path && cookie.path.startsWith('/') ? cookie.path : `/${cookie.path || ''}`;
  return `${scheme}://${host}${path}`;
}

function toCdpSetCookie(cookie) {
  const params = {
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    url: cookieUrl(cookie),
  };
  if (!cookie.name.startsWith('__Host-') && cookie.domain) {
    params.domain = cookie.domain;
  }
  if (!cookie.session && cookie.expires != null) params.expires = cookie.expires;
  if (cookie.sameSite === 'strict') params.sameSite = 'Strict';
  else if (cookie.sameSite === 'lax') params.sameSite = 'Lax';
  else if (cookie.sameSite === 'none') params.sameSite = 'None';
  return params;
}

function toBidiSetCookie(cookie) {
  const params = {
    cookie: {
      name: cookie.name,
      value: { type: 'string', value: cookie.value },
      domain: String(cookie.domain || '').replace(/^\./, ''),
      path: cookie.path || '/',
      httpOnly: cookie.httpOnly === true,
      secure: cookie.secure === true,
    },
  };
  if (!cookie.session && cookie.expires != null) params.cookie.expiry = cookie.expires;
  if (cookie.sameSite === 'strict') params.cookie.sameSite = 'strict';
  else if (cookie.sameSite === 'lax') params.cookie.sameSite = 'lax';
  else if (cookie.sameSite === 'none') params.cookie.sameSite = 'none';
  else if (cookie.sameSite === 'unspecified') params.cookie.sameSite = 'default';
  return params;
}

function toExtensionSetCookie(cookie) {
  const details = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
  };
  if (!cookie.name.startsWith('__Host-') && cookie.domain) {
    details.domain = cookie.domain;
  }
  if (!cookie.session && cookie.expires != null) details.expirationDate = cookie.expires;
  if (cookie.sameSite === 'strict') details.sameSite = 'strict';
  else if (cookie.sameSite === 'lax') details.sameSite = 'lax';
  else if (cookie.sameSite === 'none') details.sameSite = 'no_restriction';
  else if (cookie.sameSite === 'unspecified') details.sameSite = 'unspecified';
  return details;
}

function publicCookieWriteResult(result = {}) {
  return {
    set: Number(result.set) || 0,
    skipped: Number(result.skipped) || 0,
    reasons: Array.isArray(result.reasons)
      ? result.reasons.map((item) => ({
        name: item && item.name ? item.name : null,
        reason: item && item.reason ? item.reason : 'set-failed',
      }))
      : [],
  };
}

function publicCookieSyncResult(result = {}) {
  return {
    domain: result.domain || '',
    copied: Number(result.copied) || 0,
    skipped: Number(result.skipped) || 0,
    reasons: Array.isArray(result.reasons)
      ? result.reasons.map((item) => ({
        name: item && item.name ? item.name : null,
        reason: item && item.reason ? item.reason : 'skipped',
      }))
      : [],
    source: result.source || null,
    destination: result.destination || null,
  };
}

module.exports = {
  classifyCookies,
  cookieIdentity,
  cookieMatchesDomain,
  cookieUrl,
  publicCookieSyncResult,
  publicCookieWriteResult,
  skipCookieReason,
  toBidiSetCookie,
  toCanonicalCookie,
  toCdpSetCookie,
  toExtensionSetCookie,
};
