'use strict';

// replay-templates/index.js — 在 jse-replay / translate() 前由 templateBootstrap 加载，向 hyperframes registry 注册 list/item。
// ---------------------------------------------------------------------------

const { register } = require('@js-eyes/visual-replay-hyperframes/templates/registry');
const renderList = require('./list');
const renderItem = require('./item');

const SKILL_ID = 'js-reddit-ops-skill';

register(SKILL_ID, 'list', renderList);
register(SKILL_ID, 'item', renderItem);

register('*', 'list', renderList);
register('*', 'item', renderItem);

module.exports = {
  SKILL_ID,
  renderList,
  renderItem,
};
