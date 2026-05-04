'use strict';

// templates/reddit/index.js
// ---------------------------------------------------------------------------
// v0.6.0 snapshot-only-prune：
//   - tree/global/navigation/write 模板已删（snapshot 模式真截图承载，
//     非 snapshot 段由 _generic/genericKv 兜底）
//   - 仅保留 list / item 两个最常被 template-mode 命中的卡片模板
// ---------------------------------------------------------------------------

const { register } = require('../registry');
const renderList = require('./list');
const renderItem = require('./item');

const SKILL_ID = 'js-reddit-ops-skill';

register(SKILL_ID, 'list', renderList);
register(SKILL_ID, 'item', renderItem);

// 通配兜底：未知 skillId 但 kind 已知时也走 reddit 卡片模板
register('*', 'list', renderList);
register('*', 'item', renderItem);

module.exports = {
  SKILL_ID,
  renderList,
  renderItem,
};
