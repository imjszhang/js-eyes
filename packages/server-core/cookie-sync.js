'use strict';

const { isOperationSupportedByConnector } = require('@js-eyes/protocol');
const {
  classifyCookies,
  publicCookieSyncResult,
} = require('./connectors/cookie-record');
const { getClientId, pickUniqueBrowserClient } = require('./connectors/registry');

function connectorError(code, message) {
  const error = /** @type {Error & { code?: string }} */ (new Error(message));
  error.code = code;
  return error;
}

function requireClient(state, target, label) {
  if (!target) {
    throw connectorError('TARGET_REQUIRED', `${label} browser clientId or unique browser name is required`);
  }
  const picked = pickUniqueBrowserClient(state, target);
  if (picked.error) {
    throw connectorError(picked.error, picked.message);
  }
  return picked.client;
}

function requireCapability(client, operationId, label) {
  const kind = client.kind || 'extension';
  if (!isOperationSupportedByConnector(operationId, kind)) {
    throw connectorError(
      'CAPABILITY_UNSUPPORTED',
      `Connector ${kind} (${label}) does not support ${operationId}`,
    );
  }
}

async function syncCookiesBetweenClients(state, input, requestFromClient) {
  const domain = String(input.domain || '').trim();
  if (!domain) {
    throw connectorError('INVALID_ARGUMENT', 'domain is required');
  }
  const sourceClient = requireClient(state, input.source, 'source');
  const destinationClient = requireClient(state, input.destination, 'destination');
  const sourceId = getClientId(state, sourceClient);
  const destinationId = getClientId(state, destinationClient);
  if (!sourceId || !destinationId) {
    throw connectorError('BROWSER_UNAVAILABLE', 'Browser client is missing a clientId');
  }
  if (sourceId === destinationId) {
    throw connectorError('INVALID_ARGUMENT', 'source and destination must be different browser clients');
  }

  requireCapability(sourceClient, 'cookies.readDomain', 'source');
  requireCapability(destinationClient, 'cookies.write', 'destination');

  const includeSubdomains = input.includeSubdomains !== false;
  const overwrite = input.overwrite === 'replace' ? 'replace' : 'merge';

  const readResult = await requestFromClient(sourceClient, 'get_cookies_by_domain', {
    domain,
    includeSubdomains,
  });
  if (readResult.status === 'error') {
    throw connectorError(readResult.code || 'CONNECTOR_ERROR', readResult.message || 'Failed to read source cookies');
  }

  const classified = classifyCookies(readResult.cookies || []);
  const writeResult = await requestFromClient(destinationClient, 'set_cookies', {
    cookies: classified.cookies,
    overwrite,
    domain,
  });
  if (writeResult.status === 'error') {
    throw connectorError(writeResult.code || 'CONNECTOR_ERROR', writeResult.message || 'Failed to write destination cookies');
  }

  return publicCookieSyncResult({
    domain,
    copied: writeResult.set || 0,
    skipped: classified.skipped + (writeResult.skipped || 0),
    reasons: [...classified.reasons, ...(writeResult.reasons || [])],
    source: sourceId,
    destination: destinationId,
  });
}

module.exports = {
  syncCookiesBetweenClients,
};
