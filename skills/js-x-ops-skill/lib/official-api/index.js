'use strict';

const { OfficialApiClient } = require('./client');
const { OfficialApiMediaClient } = require('./media');
const { buildSearchQueryOptions } = require('./buildSearchQuery');
const { normalizeSearchTweet, normalizeSearchResults } = require('./normalizeSearchTweet');
const { markdownToDraftJs } = require('./draftJsBuilder');
const { resolveArticleMedia, toArticleMediaRef } = require('./articleMedia');

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
  buildSearchQueryOptions,
  normalizeSearchTweet,
  normalizeSearchResults,
  markdownToDraftJs,
  resolveArticleMedia,
  toArticleMediaRef,
};
