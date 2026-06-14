'use strict';

const {
  createRunId,
  createSkillRunContext,
  resolveRecordingState,
} = require('@js-eyes/skill-recording');

function normalizeGithubUrl(inputUrl) {
  const url = new URL(inputUrl);
  url.hash = '';

  for (const key of Array.from(url.searchParams.keys())) {
    if (key.startsWith('utm_') || key === 'ref' || key === 'source') {
      url.searchParams.delete(key);
    }
  }

  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  url.pathname = pathname;
  return url.toString();
}

function createRunContext(options) {
  return createSkillRunContext({
    ...options,
    url: options.url,
    normalizeInput: normalizeGithubUrl,
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
  normalizeGithubUrl,
  resolveRecordingState,
};
