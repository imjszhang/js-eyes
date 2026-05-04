'use strict';

const { escapeHtml } = require('@js-eyes/visual-replay-hyperframes/lib/escape');
const { renderCard, fmtCount } = require('./cardTemplate');

/**
 * reddit list 模板：把 payload.items[] 渲成 8 张垂直卡片。
 * payload shape：
 *   { items: [item...], totalCount, sub, sort, label, target }
 */
function renderList(ctx){
  const payload = (ctx && ctx.payload) || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const top = items.slice(0, 8);
  const sub = String(payload.sub || (ctx.hint && ctx.hint.target) || '').replace(/^r\//, '');
  const sort = String(payload.sort || '').toLowerCase();
  const total = Number.isFinite(payload.totalCount) ? payload.totalCount : items.length;

  const fallbackTitle = String(
    payload.label
    || (ctx && ctx.label)
    || (ctx && ctx.hint && ctx.hint.label)
    || 'reddit'
  );

  return [
    '<section class="reddit-stage" data-kind="list">',
    '  <header class="reddit-stage-head">',
    sub
      ? '    <h2 class="sub-title">r/' + escapeHtml(sub) + '</h2>'
      : '    <h2 class="sub-title">' + escapeHtml(fallbackTitle) + '</h2>',
    sort ? '    <span class="sort-tag">' + escapeHtml(sort) + '</span>' : '',
    '    <span class="count-tag">' + escapeHtml(fmtCount(total)) + ' items</span>',
    '  </header>',
    '  <ol class="reddit-card-list">',
    top.map((item, i) => '<li>' + renderCard(item, { index: i }) + '</li>').join('\n'),
    '  </ol>',
    top.length === 0 ? '  <div class="empty-hint">no items in payload</div>' : '',
    '</section>',
  ].filter(Boolean).join('\n');
}

module.exports = renderList;
