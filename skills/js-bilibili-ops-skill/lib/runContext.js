'use strict';

const {
  createRunId,
  createUrlSkillRunContext,
  resolveRecordingState,
} = require('@js-eyes/skill-recording');
const { extractVideoId } = require('./bilibiliUtils');

function normalizeBilibiliUrl(inputUrl) {
  const videoId = extractVideoId(inputUrl);
  if (!videoId) {
    throw new Error(`无法解析视频 ID: ${inputUrl}`);
  }
  return `https://www.bilibili.com/video/${videoId}`;
}

function createRunContext(options) {
  return createUrlSkillRunContext({
    ...options,
    normalizeUrl: normalizeBilibiliUrl,
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
  normalizeBilibiliUrl,
  resolveRecordingState,
};
