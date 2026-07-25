'use strict';

const {
  createRunId,
  createUrlSkillRunContext,
  resolveRecordingState,
} = require('@js-eyes/skill-recording');

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
  return createUrlSkillRunContext({
    ...options,
    normalizeUrl: normalizeJikeUrl,
  });
}

module.exports = {
  createRunContext,
  createRunId,
  normalizeJikeUrl,
  resolveRecordingState,
};
