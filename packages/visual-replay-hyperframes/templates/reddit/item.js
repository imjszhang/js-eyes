'use strict';

const { escapeHtml } = require('../../lib/escape');
const { renderCard, fmtCount } = require('./cardTemplate');

/**
 * reddit item 模板：单 item 渲成大卡片 + 元信息。
 * payload shape：单条 redditItem（id/title/author/score/...）或 { summary, fields }
 */
function renderItem(ctx){
  const payload = (ctx && ctx.payload) || {};
  const fullname = String(payload.id || payload.name || payload.fullname || '');

  // 兜底：subreddit_about / user_profile 走 global-style fields 列表
  if (!fullname && Array.isArray(payload.fields) && payload.fields.length) {
    return renderInfoCard(ctx, payload);
  }

  return [
    '<section class="reddit-stage" data-kind="item">',
    '  <header class="reddit-stage-head">',
    '    <h2 class="sub-title">' + escapeHtml(payload.title ? String(payload.title).slice(0, 80) : 'reddit item') + '</h2>',
    payload.subreddit ? '    <span class="sort-tag">r/' + escapeHtml(String(payload.subreddit)) + '</span>' : '',
    '  </header>',
    '  <div class="reddit-card-list single">',
    renderCard(payload, { index: 0 }),
    '  </div>',
    '</section>',
  ].filter(Boolean).join('\n');
}

function renderInfoCard(ctx, payload){
  const fields = Array.isArray(payload.fields) ? payload.fields.slice(0, 12) : [];
  const summary = String(payload.summary || '').slice(0, 200);
  const label = (ctx && ctx.label) || '';

  return [
    '<section class="reddit-stage" data-kind="item-info">',
    '  <header class="reddit-stage-head">',
    '    <h2 class="sub-title">' + escapeHtml(label || 'reddit info') + '</h2>',
    '  </header>',
    '  <article class="reddit-info-card flash-target"' + (ctx && ctx.anchorId ? ' data-anchor-id="' + escapeHtml(ctx.anchorId) + '"' : '') + '>',
    summary ? '    <p class="summary">' + escapeHtml(summary) + '</p>' : '',
    '    <dl class="kv-grid">',
    fields.map((f) => '      <div class="kv-row"><dt>' + escapeHtml(f.k) + '</dt><dd>' + escapeHtml(String(f.v).slice(0, 120)) + '</dd></div>').join('\n'),
    '    </dl>',
    '  </article>',
    '</section>',
  ].filter(Boolean).join('\n');
}

module.exports = renderItem;
