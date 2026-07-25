'use strict';

const {
  createRunId,
  createUrlSkillRunContext,
  resolveRecordingState,
} = require('@js-eyes/skill-recording');

function normalizeUrl(inputUrl) {
  const url = new URL(inputUrl);
  url.hash = '';
  for (const key of Array.from(url.searchParams.keys())) {
    if (key.startsWith('utm_') || key === 'ref' || key === 'ref_source') {
      url.searchParams.delete(key);
    }
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

function createRunContext(options) {
  return createUrlSkillRunContext({
    ...options,
    normalizeUrl,
  });
}

module.exports = {
  createRunContext,
  createRunId,
  normalizeUrl,
  resolveRecordingState,
};
