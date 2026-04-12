'use strict';

const { createRunId, createSkillRunContext, resolveRecordingState } = require('@js-eyes/skill-recording');

function normalizeWechatUrl(inputUrl) {
  const url = new URL(inputUrl);
  url.hash = '';
  return url.toString();
}

function createRunContext(options) {
  return createSkillRunContext({
    ...options,
    url: options.url,
    normalizeInput: normalizeWechatUrl,
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
  normalizeWechatUrl,
  resolveRecordingState,
};
