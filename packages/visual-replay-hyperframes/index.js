'use strict';

const { translate } = require('./lib/translator');
const { buildTimeline } = require('./lib/timeline');
const { loadRuntimeCss } = require('./lib/styleEmbed');

module.exports = {
  translate,
  buildTimeline,
  loadRuntimeCss,
};
