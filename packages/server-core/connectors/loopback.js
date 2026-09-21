'use strict';

const { isLoopbackHost } = require('@js-eyes/protocol');

function parseEndpointUrl(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) throw new Error('Browser connector endpoint is required');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return new URL(`http://${raw}`);
  }
  return new URL(raw);
}

function assertLoopbackEndpoint(endpoint, { loopbackOnly = true, allowRemoteBind = false, label = 'connector' } = {}) {
  const url = parseEndpointUrl(endpoint);
  const loopback = isLoopbackHost(url.hostname);
  if (loopbackOnly && !loopback) {
    throw new Error(`${label} endpoint must be loopback when loopbackOnly=true: ${url.hostname}`);
  }
  if (!loopback && !allowRemoteBind) {
    throw new Error(`${label} non-loopback endpoint requires security.allowRemoteBind=true`);
  }
  return url;
}

function redactEndpoint(endpoint) {
  try {
    const url = parseEndpointUrl(endpoint);
    return `${url.protocol}//${url.hostname}:${url.port || ''}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return '(invalid-endpoint)';
  }
}

module.exports = {
  assertLoopbackEndpoint,
  parseEndpointUrl,
  redactEndpoint,
};
