'use strict';

const { createRunId, createSkillRunContext, resolveRecordingState } = require('@js-eyes/skill-recording');

function normalizeZhihuUrl(inputUrl) {
  const url = new URL(inputUrl);
  url.hash = '';

  for (const key of Array.from(url.searchParams.keys())) {
    if (key.startsWith('utm_') || key === 'utm_psn' || key === 'utm_id') {
      url.searchParams.delete(key);
    }
  }

  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

function createRunContext(options) {
  return createSkillRunContext({
    ...options,
    url: options.url,
    normalizeInput: normalizeZhihuUrl,
    buildCacheKeyParts: ({ skillId, scrapeType, normalizedInput, skillVersion }) => ({
      skillId,
      scrapeType,
      url: normalizedInput,
      version: skillVersion,
    }),
  });
}

module.exports = {
  createRunContext,
  createRunId,
  normalizeZhihuUrl,
  resolveRecordingState,
};
