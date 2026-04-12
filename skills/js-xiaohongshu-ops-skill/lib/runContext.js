'use strict';

const { createRunId, createSkillRunContext, resolveRecordingState } = require('@js-eyes/skill-recording');

function normalizeXhsUrl(inputUrl) {
  const url = new URL(inputUrl);
  url.hash = '';

  for (const key of Array.from(url.searchParams.keys())) {
    if (key.startsWith('utm_') || key === 'share_from_user_hidden') {
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
    normalizeInput: normalizeXhsUrl,
    buildCacheKeyParts: ({ skillId, scrapeType, normalizedInput, skillVersion, options: runOptions }) => ({
      skillId,
      scrapeType,
      url: normalizedInput,
      maxCommentPages: Number(runOptions.maxCommentPages || 0),
      version: skillVersion,
    }),
  });
}

module.exports = {
  createRunContext,
  createRunId,
  normalizeXhsUrl,
  resolveRecordingState,
};
