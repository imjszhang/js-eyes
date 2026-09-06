'use strict';

const {
  createRunId,
  createUrlSkillRunContext,
  resolveRecordingState,
} = require('@js-eyes/skill-recording');

function normalizeUrl(inputUrl) {
  const url = new URL(inputUrl);
  url.hash = '';
  for (const key of Array.from(url.searchParams.keys())) {
    if (key.startsWith('utm_') || key === 'ref' || key === 'ref_source') {
      url.searchParams.delete(key);
    }
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

function normalizeReadPageCacheVary(options = {}) {
  const format = options.format === 'html' || options.format === 'text'
    ? options.format
    : 'markdown';
  const maxContentChars = Number.isFinite(options.maxContentChars)
    ? Math.max(0, Math.trunc(options.maxContentChars))
    : null;

  return {
    schema: 1,
    format,
    tabId: Number.isInteger(options.tabId) ? options.tabId : null,
    maxContentChars,
    includeLinks: options.includeLinks !== false,
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
