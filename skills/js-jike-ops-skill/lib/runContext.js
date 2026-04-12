'use strict';

const { createRunId, createSkillRunContext, resolveRecordingState } = require('@js-eyes/skill-recording');

function normalizeJikeUrl(inputUrl) {
  if (typeof inputUrl !== 'string') {
    throw new Error('缺少即刻链接');
  }

  const mobileMatch = inputUrl.match(/https:\/\/m\.okjike\.com\/originalPosts\/([\w-]+)/);
  const normalized = mobileMatch
    ? `https://web.okjike.com/originalPost/${mobileMatch[1]}`
    : inputUrl;

  const url = new URL(normalized);
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

function createRunContext(options) {
  return createSkillRunContext({
    ...options,
    url: options.url,
    normalizeInput: normalizeJikeUrl,
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
  normalizeJikeUrl,
  resolveRecordingState,
};
