'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  BROWSER_OPERATIONS,
  CONNECTOR_KINDS,
  isOperationSupportedByConnector,
  listOperationIdsForConnector,
} = require('../index');

describe('connector capability matrix', () => {
  it('lists extension, cdp, and bidi', () => {
    assert.deepEqual(CONNECTOR_KINDS.slice(), ['extension', 'cdp', 'bidi']);
  });

  it('marks every operation supported on extension and cdp', () => {
    for (const operation of BROWSER_OPERATIONS) {
      assert.equal(isOperationSupportedByConnector(operation.id, 'extension'), true, operation.id);
      assert.equal(isOperationSupportedByConnector(operation.id, 'cdp'), true, operation.id);
    }
    assert.equal(listOperationIdsForConnector('extension').length, BROWSER_OPERATIONS.length);
    assert.equal(listOperationIdsForConnector('cdp').length, BROWSER_OPERATIONS.length);
  });

  it('supports the BiDi skill-facing subset', () => {
    for (const id of [
      'tabs.list', 'clients.list', 'url.open', 'tab.close', 'page.html',
      'page.info', 'page.click', 'page.fill', 'page.scroll', 'page.waitFor',
      'page.extract', 'screenshot.capture', 'cookies.read', 'cookies.readDomain',
      'cookies.write', 'cookies.sync',
      'file.upload', 'script.execute',
    ]) {
      assert.equal(isOperationSupportedByConnector(id, 'bidi'), true, id);
    }
    assert.equal(isOperationSupportedByConnector('missing.op', 'bidi'), false);
    assert.equal(isOperationSupportedByConnector('url.open', 'unknown'), false);
  });
});
