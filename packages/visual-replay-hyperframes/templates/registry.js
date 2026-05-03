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
// getTemplate(skillId, kind) 返回 { renderer, defaultClass, matchTier } 或 null。
// 查找链（v0.2.0 新增 (sid,*) / (*,*) 兜底，给 PR 2"模板冷启动"用）：
//   1. (sid, k)            最专属
//   2. (*,   k)            通配 skill + 已知 kind（reddit 给所有 skill 兜底 kind）
//   3. (sid, '*')          已知 skill + 未知 kind（少见）
//   4. (*,   '*')          终极兜底（_generic 模板）
//   5. (*,   'global')     legacy 兜底（保留以免老路径回退）
//
// matchTier 字段用于上层 translator 判断"卡片是否走了 generic fallback"，
// 进而落到 replay-summary.json 的 missingTemplates。
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
  const tiers = [
    { tier: 'exact',           key: _key(sid, k) },
    { tier: 'kind-wildcard',   key: _key('*',  k) },
    { tier: 'skill-wildcard',  key: _key(sid,  '*') },
    { tier: 'generic',         key: _key('*',  '*') },
    { tier: 'legacy-global',   key: _key('*',  'global') },
  ];
  for (const t of tiers) {
    const hit = _registry.get(t.key);
    if (hit) return Object.assign({}, hit, { matchTier: t.tier });
  }
  return null;
}

function listTemplates(){
  const out = [];
  for (const v of _registry.values()) out.push({ skillId: v.skillId, kind: v.kind, defaultClass: v.defaultClass });
  return out;
}

/**
 * findUnknownKinds - 给定一个 (skillId, kind) 列表，返回那些只能命中
 * generic / legacy-global 兜底的条目（即"上游没写专属模板"的）。
 * scaffold CLI 用它输出脚手架。
 *
 * @param {Array<{skillId:string, kind:string, count?:number}>} pairs
 * @returns {Array<{skillId:string, kind:string, count:number, tier:string}>}
 */
function findUnknownKinds(pairs){
  const out = [];
  for (const p of (pairs || [])) {
    const tpl = getTemplate(p.skillId, p.kind);
    if (!tpl) continue;
    if (tpl.matchTier === 'generic' || tpl.matchTier === 'legacy-global' || tpl.matchTier === 'skill-wildcard') {
      out.push({ skillId: p.skillId, kind: p.kind, count: p.count || 1, tier: tpl.matchTier });
    }
  }
  return out;
}

function _resetForTesting(){
  _registry.clear();
}

module.exports = {
  register,
  getTemplate,
  listTemplates,
  findUnknownKinds,
  _resetForTesting,
};
