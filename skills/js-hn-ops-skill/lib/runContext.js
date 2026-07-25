'use strict';

const {
  createRunId,
  createUrlSkillRunContext,
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
  return createUrlSkillRunContext({
    ...options,
    normalizeUrl: normalizeGithubUrl,
  });
}

module.exports = {
  createRunContext,
  createRunId,
  normalizeGithubUrl,
  resolveRecordingState,
};
