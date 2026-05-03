'use strict';

// templates/_generic/index.js
// ---------------------------------------------------------------------------
// 终极兜底：注册 ('*', '*') → renderGeneric。所有未被任何 skill 专属模板与
// reddit 通配模板覆盖的 (skillId, kind) 都会走这里，避免出现"卡片几乎全空 +
// no template / no payload" 这种失败兜底文案。
//
// 顺序：
//   - registry.getTemplate 的查找链是
//     (sid,k) → (*,k) → (sid,*) → (*,*) → (*,'global')
//   - 这里只注册 ('*','*')，不动 ('*','global')，避免和 reddit/global.js 冲突。
//   - reddit/index.js 后续仍会注册 ('*','list/item/tree/global/...') 这些更专 kind，
//     优先级高于 ('*','*')。
// ---------------------------------------------------------------------------

const { register } = require('../registry');
const renderGeneric = require('./genericKv');

register('*', '*', renderGeneric);

module.exports = {
  renderGeneric,
};
