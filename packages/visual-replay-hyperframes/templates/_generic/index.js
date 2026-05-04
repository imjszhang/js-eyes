'use strict';

// templates/_generic/index.js
// ---------------------------------------------------------------------------
// 终极兜底 + kind 显式兜底（v0.6.0 起承担 tree/global/navigation/write）：
//
//   - register('*','*') → 终极兜底，所有未匹配的 (sid,k) 都落这里
//   - register('*','tree' | 'global' | 'navigation' | 'write') → 显式兜底
//     这几个 kind 在 v0.5.x 由 reddit/{tree,global,navigation}.js 覆盖；
//     v0.6.0 砍掉那些模板后，需要在这里显式 register 让 registry 命中
//     'kind-wildcard' 而不是 'global-fallback' 那种弱 tier，可读性更好
//
// 顺序：
//   - registry.getTemplate 查找链：
//     (sid,k) → (*,k) → (sid,*) → (*,*) → (*,'global')
//   - 这里只用 '*' skill；技能 replay-templates 注册 (sid, 'list'/'item') 优先级更高，
//     并常同时注册 ('*','list') / ('*','item')，命中比 ('*','*') 早
// ---------------------------------------------------------------------------

const { register } = require('../registry');
const renderGeneric = require('./genericKv');

register('*', '*', renderGeneric);

// v0.6.0：删除 reddit/{tree,global,navigation}.js 后给这些 kind 显式兜底，
// 避免命中 'legacy-global' 时落 hard-fallback 空文案。
register('*', 'tree', renderGeneric);
register('*', 'global', renderGeneric);
register('*', 'navigation', renderGeneric);
register('*', 'write', renderGeneric);

module.exports = {
  renderGeneric,
};
