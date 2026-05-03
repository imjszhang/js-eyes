'use strict';

// templates/reddit/cardTemplate.js
// ---------------------------------------------------------------------------
// reddit post 卡片公共片段。卡片整体是 <article class="reddit-card">，根节点带
// data-anchor-id="<fullname>"，让 timelineScript 在 flash 时刻通过 class 切换
// 实现 outline 动画（不依赖 DOM 实测坐标）。
// ---------------------------------------------------------------------------

const { escapeHtml } = require('../../lib/escape');

function fmtCount(n){
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  if (Math.abs(num) >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(num) >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(num);
}

function fmtRelativeTime(iso){
  if (!iso) return '';
  let d;
  try { d = new Date(iso); } catch (_) { return ''; }
  if (!d || isNaN(d.getTime())) return '';
  const now = Date.now();
  const dt = (now - d.getTime()) / 1000;
  if (dt < 60) return Math.round(dt) + 's ago';
  if (dt < 3600) return Math.round(dt / 60) + 'm ago';
  if (dt < 86400) return Math.round(dt / 3600) + 'h ago';
  if (dt < 86400 * 30) return Math.round(dt / 86400) + 'd ago';
  if (dt < 86400 * 365) return Math.round(dt / (86400 * 30)) + 'mo ago';
  return Math.round(dt / (86400 * 365)) + 'y ago';
}

function safeAvatarChar(name){
  const s = String(name || '?').trim();
  return escapeHtml(s.slice(0, 1).toUpperCase());
}

/**
 * @param {object} item - extractRedditItemFields 输出
 * @param {object} [opts]
 * @param {number} [opts.index] - 在卡片列表中的序号（0-based），用于 staggered 入场动画
 */
function renderCard(item, opts){
  const o = opts || {};
  const it = item || {};
  const fullname = String(it.id || it.name || it.fullname || '');
  const cls = ['reddit-card', 'flash-target'];
  if (it.is_video) cls.push('is-video');
  if (it.is_self) cls.push('is-self');
  if (it.over_18) cls.push('is-nsfw');
  const indexAttr = Number.isFinite(o.index) ? ' style="--idx:' + o.index + ';"' : '';
  const subreddit = String(it.subreddit || '').replace(/^r\//, '');
  const author = String(it.author || '').replace(/^u\//, '');
  const flair = String(it.link_flair_text || it.flair || '').trim();
  const title = String(it.title || '').slice(0, 220);
  const preview = String(it.contentPreview || '').slice(0, 220);
  const score = it.score != null ? it.score : it.ups;
  const comments = it.num_comments;
  const createdAt = fmtRelativeTime(it.createdAt);

  return [
    '<article',
    '  class="' + cls.join(' ') + '"',
    fullname ? '  id="card-' + escapeHtml(fullname) + '"' : '',
    fullname ? '  data-anchor-id="' + escapeHtml(fullname) + '"' : '',
    indexAttr,
    '>',
    '  <div class="card-aside">',
    '    <div class="vote-up" aria-hidden="true">▲</div>',
    '    <div class="score" title="score">' + escapeHtml(fmtCount(score)) + '</div>',
    '    <div class="vote-dn" aria-hidden="true">▼</div>',
    '  </div>',
    '  <div class="card-main">',
    '    <header class="card-head">',
    subreddit ? '      <span class="sub-pill">r/' + escapeHtml(subreddit) + '</span>' : '',
    author ? '      <span class="by">posted by <em>u/' + escapeHtml(author) + '</em></span>' : '',
    createdAt ? '      <span class="time">' + escapeHtml(createdAt) + '</span>' : '',
    flair ? '      <span class="flair">' + escapeHtml(flair) + '</span>' : '',
    '    </header>',
    title ? '    <h3 class="title">' + escapeHtml(title) + '</h3>' : '',
    preview ? '    <p class="preview">' + escapeHtml(preview) + '</p>' : '',
    '    <footer class="card-foot">',
    '      <span class="comments">' + escapeHtml(fmtCount(comments)) + ' comments</span>',
    '      <span class="share">share</span>',
    '      <span class="save">save</span>',
    fullname ? '      <span class="fullname" title="reddit fullname">' + escapeHtml(fullname) + '</span>' : '',
    '    </footer>',
    '  </div>',
    '</article>',
  ].filter(Boolean).join('\n');
}

function renderAvatarPill(name, kind){
  const label = String(name || '?');
  const prefix = kind === 'user' ? 'u/' : (kind === 'sub' ? 'r/' : '');
  return [
    '<span class="avatar-pill" data-kind="' + escapeHtml(kind || '') + '">',
    '  <span class="avatar-glyph">' + safeAvatarChar(label) + '</span>',
    '  <span class="avatar-text">' + escapeHtml(prefix + label) + '</span>',
    '</span>',
  ].join('\n');
}

module.exports = {
  renderCard,
  renderAvatarPill,
  fmtCount,
  fmtRelativeTime,
  safeAvatarChar,
};
