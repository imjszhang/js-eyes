'use strict';

// templates/registry.js
// ---------------------------------------------------------------------------
// post-2.7.0 architecture pivot：events 里 hint.kind + payload 路由到 HTML 模板。
//
// 模板注册接口：
//   register(skillId, kind, renderer)
//     - skillId: 'js-reddit-ops-skill' / 'js-browser-ops-skill' / '*' (兜底)
//     - kind:    'list' | 'item' | 'tree' | 'global' | 'navigation' | 'write'
//     - renderer({ payload, anchorId, hint, label, target, tone, eventIndex }) => htmlString
//       - 返回值是 HTML 片段（不含 <script>），由 translator 嵌入 #stage 主舞台
//       - 必须是响应式 CSS（vw/clamp/max-width），不允许写死像素 left/top
//
// getTemplate(skillId, kind) 返回 { renderer, defaultClass } 或 null。优先匹配
// (skillId, kind)，其次 ('*', kind)，最后回退到 'global' 兜底。
// ---------------------------------------------------------------------------

const _registry = new Map();
function _key(skillId, kind){ return String(skillId || '*') + '::' + String(kind || 'global'); }

function register(skillId, kind, renderer, opts){
  if (typeof renderer !== 'function') throw new Error('register: renderer must be a function');
  _registry.set(_key(skillId, kind), {
    skillId: skillId || '*',
    kind: kind || 'global',
    renderer,
    defaultClass: (opts && opts.defaultClass) || 'jse-tpl-' + (kind || 'global'),
  });
}

function getTemplate(skillId, kind){
  const k = String(kind || 'global');
  const sid = String(skillId || '');
  const direct = _registry.get(_key(sid, k));
  if (direct) return direct;
  const fallback = _registry.get(_key('*', k));
  if (fallback) return fallback;
  // 最终兜底：global
  return _registry.get(_key('*', 'global')) || null;
}

function listTemplates(){
  const out = [];
  for (const v of _registry.values()) out.push({ skillId: v.skillId, kind: v.kind, defaultClass: v.defaultClass });
  return out;
}

function _resetForTesting(){
  _registry.clear();
}

module.exports = {
  register,
  getTemplate,
  listTemplates,
  _resetForTesting,
};
