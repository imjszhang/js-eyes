'use strict';

const {
  createRunId,
  createUrlSkillRunContext,
  resolveRecordingState,
} = require('@js-eyes/skill-recording');

function normalizeGoogleUrl(inputUrl) {
  const url = new URL(inputUrl);
  url.hash = '';
  for (const key of Array.from(url.searchParams.keys())) {
    if (key.startsWith('utm_') || key === 'ref' || key === 'source' || key === 'sxsrf' || key === 'ei' || key === 'ved') {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

function createRunContext(options) {
  return createUrlSkillRunContext({
    ...options,
    normalizeUrl: normalizeGoogleUrl,
  });
}

module.exports = {
  createRunContext,
  createRunId,
  normalizeGoogleUrl,
  resolveRecordingState,
};
