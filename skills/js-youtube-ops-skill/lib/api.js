'use strict';

const {
  getYoutubeSubtitlesResult,
  getYoutubeVideoDetails,
} = require('./youtubeUtils');

async function getVideo(url, options = {}) {
  return getYoutubeVideoDetails(url, options);
}

async function getSubtitles(url, options = {}) {
  return getYoutubeSubtitlesResult(url, options);
}

module.exports = { getVideo, getSubtitles };
