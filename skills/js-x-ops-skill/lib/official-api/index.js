'use strict';

const { OfficialApiClient } = require('./client');
const { OfficialApiMediaClient } = require('./media');

function createOfficialApiClient(opts = {}) {
  return new OfficialApiClient(opts);
}

function isConfigured() {
  return createOfficialApiClient().isConfigured;
}

module.exports = {
  OfficialApiClient,
  OfficialApiMediaClient,
  createOfficialApiClient,
  isConfigured,
};
