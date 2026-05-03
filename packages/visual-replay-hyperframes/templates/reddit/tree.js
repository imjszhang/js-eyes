'use strict';

const { escapeHtml } = require('../../lib/escape');
const { fmtCount, fmtRelativeTime } = require('./cardTemplate');

/**
 * reddit tree 模板：评论树（expand-more 等）。
 * payload shape：{ items: [...], relations: [{from,to,depth?}], label }
 */
function renderTree(ctx){
  const payload = (ctx && ctx.payload) || {};
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 24) : [];
  const relations = Array.isArray(payload.relations) ? payload.relations : [];
  const label = (ctx && ctx.label) || 'comments';

  // 由 relations 推 depth；缺失 depth 时用 BFS 从根（无 parent 在 items 里的节点）算
  const idDepth = inferDepths(items, relations);

  return [
    '<section class="reddit-stage" data-kind="tree">',
    '  <header class="reddit-stage-head">',
    '    <h2 class="sub-title">' + escapeHtml(label) + '</h2>',
    '    <span class="count-tag">' + escapeHtml(fmtCount(items.length)) + ' comments</span>',
    '  </header>',
    '  <ul class="reddit-comment-tree">',
    items.map((it) => renderNode(it, idDepth.get(String(it.id || it.name || '')) || 0)).join('\n'),
    items.length === 0 ? '    <li class="empty-hint">no comments in payload</li>' : '',
    '  </ul>',
    '</section>',
  ].filter(Boolean).join('\n');
}

function renderNode(it, depth){
  if (!it) return '';
  const fullname = String(it.id || it.name || it.fullname || '');
  const author = String(it.author || '').replace(/^u\//, '');
  const body = String(it.contentPreview || it.body || it.body_md || it.title || '').slice(0, 220);
  const score = it.score != null ? it.score : it.ups;
  const createdAt = fmtRelativeTime(it.createdAt);
  const d = Math.max(0, Math.min(depth || 0, 8));

  return [
    '    <li class="comment-node flash-target" style="--depth:' + d + ';"',
    fullname ? '      id="cmt-' + escapeHtml(fullname) + '"' : '',
    fullname ? '      data-anchor-id="' + escapeHtml(fullname) + '"' : '',
    '    >',
    '      <div class="comment-spine" aria-hidden="true"></div>',
    '      <div class="comment-body">',
    '        <header class="comment-head">',
    author ? '          <span class="author">u/' + escapeHtml(author) + '</span>' : '<span class="author">[deleted]</span>',
    Number.isFinite(Number(score)) ? '          <span class="comment-score">' + escapeHtml(fmtCount(score)) + ' pts</span>' : '',
    createdAt ? '          <span class="comment-time">' + escapeHtml(createdAt) + '</span>' : '',
    '        </header>',
    body ? '        <p class="comment-text">' + escapeHtml(body) + '</p>' : '',
    '      </div>',
    '    </li>',
  ].filter(Boolean).join('\n');
}

function inferDepths(items, relations){
  const out = new Map();
  if (!Array.isArray(items)) return out;
  const ids = new Set(items.map((it) => String(it.id || it.name || '')).filter(Boolean));
  // 使用 relations 构建 parent map
  const parentOf = new Map();
  for (const r of relations || []) {
    if (!r || typeof r.from !== 'string' || typeof r.to !== 'string') continue;
    parentOf.set(String(r.to), String(r.from));
  }
  // items 内部也可能带 parent_id
  for (const it of items) {
    const id = String(it.id || it.name || '');
    if (!id) continue;
    if (!parentOf.has(id)) {
      const p = it.parent_id || it._parent_id;
      if (typeof p === 'string') parentOf.set(id, p);
    }
  }
  // 提供 depth 字段时直接用
  for (const it of items) {
    const id = String(it.id || it.name || '');
    if (Number.isFinite(it.depth)) out.set(id, it.depth);
  }
  // 其余按 parent 链向上爬，根节点 = parent 不在 items 中 / 找不到 parent
  for (const it of items) {
    const id = String(it.id || it.name || '');
    if (out.has(id)) continue;
    let depth = 0;
    let cursor = parentOf.get(id);
    const visited = new Set([id]);
    while (cursor && ids.has(cursor) && !visited.has(cursor)) {
      depth += 1;
      visited.add(cursor);
      cursor = parentOf.get(cursor);
      if (depth > 8) break;
    }
    out.set(id, depth);
  }
  return out;
}

module.exports = renderTree;
