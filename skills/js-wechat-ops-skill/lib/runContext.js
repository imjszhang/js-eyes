'use strict';

const {
  createRunId,
  createUrlSkillRunContext,
  resolveRecordingState,
} = require('@js-eyes/skill-recording');

function normalizeWechatUrl(inputUrl) {
  const url = new URL(inputUrl);
  url.hash = '';
  return url.toString();
}

function createRunContext(options) {
  return createUrlSkillRunContext({
    ...options,
    normalizeUrl: normalizeWechatUrl,
  });
}

module.exports = {
  createRunContext,
  createRunId,
  normalizeWechatUrl,
  resolveRecordingState,
};
