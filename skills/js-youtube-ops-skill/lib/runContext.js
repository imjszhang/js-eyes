'use strict';

const { createRunId, createSkillRunContext, resolveRecordingState } = require('@js-eyes/skill-recording');
const { extractVideoId } = require('./youtubeUtils');

function normalizeYoutubeUrl(inputUrl) {
  const videoId = extractVideoId(inputUrl);
  if (!videoId) {
    throw new Error(`无法解析视频 ID: ${inputUrl}`);
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function createRunContext(options) {
  return createSkillRunContext({
    ...options,
    url: options.url,
    normalizeInput: normalizeYoutubeUrl,
    buildCacheKeyParts: ({ skillId, scrapeType, normalizedInput, skillVersion, options: runOptions }) => ({
      skillId,
      scrapeType,
      url: normalizedInput,
      includeSubtitles: runOptions.includeSubtitles !== false,
      subLangs: runOptions.subLangs || '',
      noCookies: runOptions.noCookies === true,
      cookiesFromBrowser: runOptions.cookiesFromBrowser || '',
      version: skillVersion,
    }),
  });
}

module.exports = {
  createRunContext,
  createRunId,
  normalizeYoutubeUrl,
  resolveRecordingState,
};
