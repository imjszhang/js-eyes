'use strict';

// templates/reddit/index.js
// ---------------------------------------------------------------------------
// 注册 reddit-skill 五个 hint.kind 的模板渲染器。
// ---------------------------------------------------------------------------

const { register } = require('../registry');
const renderList = require('./list');
const renderItem = require('./item');
const renderTree = require('./tree');
const renderGlobal = require('./global');
const renderNavigation = require('./navigation');

const SKILL_ID = 'js-reddit-ops-skill';

register(SKILL_ID, 'list', renderList);
register(SKILL_ID, 'item', renderItem);
register(SKILL_ID, 'tree', renderTree);
register(SKILL_ID, 'global', renderGlobal);
register(SKILL_ID, 'navigation', renderNavigation);
register(SKILL_ID, 'write', renderGlobal);

// 通配兜底：未知 skillId 但 kind 已知时也走 reddit 模板
register('*', 'list', renderList);
register('*', 'item', renderItem);
register('*', 'tree', renderTree);
register('*', 'global', renderGlobal);
register('*', 'navigation', renderNavigation);
register('*', 'write', renderGlobal);

module.exports = {
  SKILL_ID,
  renderList,
  renderItem,
  renderTree,
  renderGlobal,
  renderNavigation,
};
