'use strict';

const {
  getBilibiliSubtitlesResult,
  getBilibiliVideoDetails,
} = require('./bilibiliUtils');

async function getVideo(url, options = {}) {
  return getBilibiliVideoDetails(url, options);
}

async function getSubtitles(url, options = {}) {
  return getBilibiliSubtitlesResult(url, options);
}

module.exports = { getVideo, getSubtitles };
