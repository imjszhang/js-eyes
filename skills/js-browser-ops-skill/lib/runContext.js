'use strict';

const {
  createRunId,
  createUrlSkillRunContext,
  resolveRecordingState,
} = require('@js-eyes/skill-recording');

function normalizeUrl(inputUrl) {
  const value = String(inputUrl);
  new URL(value);
  return value;
}

function normalizeReadPageCacheVary(options = {}) {
  const format = options.format === 'html' || options.format === 'text'
    ? options.format
    : 'markdown';

  return {
    schema: 2,
    format,
  };
}

function createRunContext(options) {
  const cacheVary = normalizeReadPageCacheVary(options);
  return createUrlSkillRunContext({
    ...options,
    normalizeUrl,
    buildCacheKeyParts: ({
      skillId,
      scrapeType,
      normalizedInput,
      skillVersion,
    }) => ({
      skillId,
      scrapeType,
      url: normalizedInput,
      version: skillVersion,
      readPage: cacheVary,
    }),
  });
}

module.exports = {
  createRunContext,
  createRunId,
  normalizeReadPageCacheVary,
  normalizeUrl,
  resolveRecordingState,
};
