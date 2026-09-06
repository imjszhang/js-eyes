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
  const maxContentChars = Number.isFinite(Number(options.maxContentChars)) && Number(options.maxContentChars) > 0
    ? Math.floor(Number(options.maxContentChars))
    : 0;

  return {
    schema: 2,
    format,
    maxContentChars,
    includeLinks: options.includeLinks !== false,
    includeImages: options.includeImages !== false,
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
