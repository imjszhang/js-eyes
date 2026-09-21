'use strict';

/**
 * Connector kinds and the operation-id capability matrix.
 *
 * `routing: 'extension'` on browser operations still means "send to a browser
 * connector" for this cycle. Do not add a silent `browser` routing alias.
 */

const { BROWSER_OPERATIONS } = require('./browser-operations');

const CONNECTOR_KINDS = Object.freeze(['extension', 'cdp', 'bidi']);

const ALL_OPERATION_IDS = Object.freeze(BROWSER_OPERATIONS.map((operation) => operation.id));

const BIDI_UNSUPPORTED = Object.freeze([]);

const CONNECTOR_CAPABILITY_MATRIX = Object.freeze({
  extension: Object.freeze(Object.fromEntries(ALL_OPERATION_IDS.map((id) => [id, true]))),
  cdp: Object.freeze(Object.fromEntries(ALL_OPERATION_IDS.map((id) => [id, true]))),
  bidi: Object.freeze(Object.fromEntries(ALL_OPERATION_IDS.map((id) => [
    id,
    !BIDI_UNSUPPORTED.includes(id),
  ]))),
});

function isConnectorKind(kind) {
  return CONNECTOR_KINDS.includes(kind);
}

function isOperationSupportedByConnector(operationId, kind) {
  const matrix = CONNECTOR_CAPABILITY_MATRIX[kind];
  if (!matrix) return false;
  return matrix[operationId] === true;
}

function listOperationIdsForConnector(kind) {
  if (!isConnectorKind(kind)) return [];
  return ALL_OPERATION_IDS.filter((id) => CONNECTOR_CAPABILITY_MATRIX[kind][id] === true);
}

module.exports = {
  ALL_OPERATION_IDS,
  CONNECTOR_CAPABILITY_MATRIX,
  CONNECTOR_KINDS,
  isConnectorKind,
  isOperationSupportedByConnector,
  listOperationIdsForConnector,
};
