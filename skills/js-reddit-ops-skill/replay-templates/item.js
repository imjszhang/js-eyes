'use strict';

const { escapeHtml } = require('@js-eyes/visual-replay-hyperframes/lib/escape');
const { renderCard } = require('./cardTemplate');

/**
 * reddit item 模板：单 item 渲成大卡片 + 元信息。
 * payload shape：单条 redditItem（id/title/author/score/...）或 { summary, fields }
 */
function renderItem(ctx){
  const payload = (ctx && ctx.payload) || {};
  const fullname = String(payload.id || payload.name || payload.fullname || '');

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
  const allFields = Array.isArray(payload.fields) ? payload.fields.slice(0, 12) : [];
  const summary = String(payload.summary || '').slice(0, 240);
  const label = (ctx && ctx.label) || (ctx && ctx.hint && ctx.hint.label) || '';

  const HERO_KEYS = /^(subscribers?|subscriberCount|activeUserCount|totalKarma|comment_count|num_comments)$/i;
  const heroIdx = allFields.findIndex((f) => f && HERO_KEYS.test(f.k));
  const heroField = heroIdx >= 0 ? allFields[heroIdx] : null;
  const otherFields = heroField ? allFields.filter((_, i) => i !== heroIdx) : allFields;

  return [
    '<section class="reddit-stage" data-kind="item-info">',
    '  <header class="reddit-stage-head">',
    '    <h2 class="sub-title">' + escapeHtml(label || 'reddit info') + '</h2>',
    '  </header>',
    '  <article class="reddit-info-card flash-target"' + (ctx && ctx.anchorId ? ' data-anchor-id="' + escapeHtml(ctx.anchorId) + '"' : '') + '>',
    summary ? '    <p class="summary">' + escapeHtml(summary) + '</p>' : '',
    heroField ? renderHeroMetric(heroField) : '',
    otherFields.length ? '    <dl class="kv-grid">' : '',
    otherFields.length ? otherFields.map((f) => '      <div class="kv-row"><dt>' + escapeHtml(f.k) + '</dt><dd>' + escapeHtml(String(f.v).slice(0, 120)) + '</dd></div>').join('\n') : '',
    otherFields.length ? '    </dl>' : '',
    !heroField && !otherFields.length && !summary ? '    <p class="empty-hint">payload is empty</p>' : '',
    '  </article>',
    '</section>',
  ].filter(Boolean).join('\n');
}

function renderHeroMetric(field){
  return [
    '    <div class="hero-metric">',
    '      <span class="hero-num">' + escapeHtml(formatHeroNumber(field.v)) + '</span>',
    '      <span class="hero-label">' + escapeHtml(field.k) + '</span>',
    '    </div>',
  ].join('\n');
}

function formatHeroNumber(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

module.exports = renderItem;
