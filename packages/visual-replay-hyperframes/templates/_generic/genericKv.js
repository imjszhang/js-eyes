'use strict';

// templates/_generic/genericKv.js
// ---------------------------------------------------------------------------
// 终极兜底渲染器：当 (skillId, kind) 在 registry 里没找到任何更专门的模板时，
// 这里基于 payload 形状智能识别，渲出一张「不会丑、能看出信息密度」的卡。
//
// 三档识别：
//   1. payload.items[] 非空 → 渲成"通用 list"（用 reddit-card-list 复用 CSS class）
//   2. payload.fields[] 非空 / payload.summary 字符串 → 渲成"通用 KV / info-card"
//   3. 都为空 → 显示 raw payload JSON（折叠 details），右上角 badge 提示 unknown kind
//
// 所有 HTML 复用 reddit-* CSS class，不引入新样式（让兜底卡和 reddit 卡视觉一致）。
// ---------------------------------------------------------------------------

const { escapeHtml } = require('../../lib/escape');

function renderGeneric(ctx){
  const c = ctx || {};
  const payload = c.payload || {};
  const kind = (c.hint && c.hint.kind) || 'global';
  const skillIdHint = (c.hint && c.hint.skillId) || (c.meta && c.meta.skillId) || '';
  const label = c.label || (c.hint && c.hint.label) || (kind || 'event');
  const anchorAttr = c.anchorId ? ' data-anchor-id="' + escapeHtml(c.anchorId) + '"' : '';
  const badge = '<span class="count-tag" style="background: rgba(255, 173, 20, 0.18); color: #ffd966;">' + escapeHtml('generic · ' + (skillIdHint ? skillIdHint + '/' : '') + kind) + '</span>';

  const items = Array.isArray(payload.items) ? payload.items : null;
  const fields = Array.isArray(payload.fields) ? payload.fields : null;
  const summary = typeof payload.summary === 'string' ? payload.summary : '';

  if (items && items.length > 0) {
    return renderGenericList(label, items, badge, anchorAttr, payload);
  }

  if ((fields && fields.length > 0) || summary) {
    return renderGenericKv(label, fields || [], summary, badge, anchorAttr);
  }

  return renderGenericRaw(label, payload, badge, anchorAttr);
}

function renderGenericList(label, items, badge, anchorAttr, payload){
  const top = items.slice(0, 8);
  const totalCount = Number.isFinite(payload.totalCount) ? payload.totalCount : items.length;
  return [
    '<section class="reddit-stage" data-kind="generic-list">',
    '  <header class="reddit-stage-head">',
    '    <h2 class="sub-title">' + escapeHtml(label) + '</h2>',
    '    ' + badge,
    '    <span class="count-tag">' + totalCount + ' items</span>',
    '  </header>',
    '  <ol class="reddit-card-list"' + anchorAttr + '>',
    top.map((it, i) => '    <li>' + renderGenericItem(it, i) + '</li>').join('\n'),
    '  </ol>',
    '</section>',
  ].join('\n');
}

function renderGenericItem(item, index){
  const safe = item && typeof item === 'object' ? item : {};
  const title = pickStr(safe, ['title', 'name', 'label', 'summary', 'text']) || ('item #' + (index + 1));
  const id = pickStr(safe, ['id', 'fullname', 'name']);
  const url = pickStr(safe, ['url', 'permalink', 'href', 'link']);
  const sub = pickStr(safe, ['subreddit', 'sub', 'channel', 'category']);
  const author = pickStr(safe, ['author', 'user', 'username', 'by']);
  const score = pickStr(safe, ['score', 'votes', 'rating', 'count']);
  const preview = pickStr(safe, ['contentPreview', 'preview', 'excerpt', 'description', 'body']);
  const idAttr = id ? ' data-anchor-id="' + escapeHtml(id) + '"' : '';
  return [
    '<article class="reddit-card flash-target"' + idAttr + '>',
    '  <div class="card-aside"><span class="vote-up">▲</span><span class="score">' + escapeHtml(score || '-') + '</span><span class="vote-dn">▼</span></div>',
    '  <div class="card-main">',
    '    <div class="card-head">',
    sub ? '      <span class="sub-pill">' + escapeHtml(String(sub).replace(/^r\//, '')) + '</span>' : '',
    author ? '      <span class="by">by <em>' + escapeHtml(author) + '</em></span>' : '',
    '    </div>',
    '    <h3 class="title">' + escapeHtml(String(title).slice(0, 200)) + '</h3>',
    preview ? '    <p class="preview">' + escapeHtml(String(preview).slice(0, 240)) + '</p>' : '',
    '    <div class="card-foot">',
    url ? '      <span class="time">' + escapeHtml(String(url).slice(0, 80)) + '</span>' : '',
    id ? '      <span class="fullname">' + escapeHtml(id) + '</span>' : '',
    '    </div>',
    '  </div>',
    '</article>',
  ].filter(Boolean).join('\n');
}

function renderGenericKv(label, fields, summary, badge, anchorAttr){
  const top = fields.slice(0, 16).filter((f) => f && f.k != null);
  return [
    '<section class="reddit-stage" data-kind="generic-kv">',
    '  <header class="reddit-stage-head">',
    '    <h2 class="sub-title">' + escapeHtml(label) + '</h2>',
    '    ' + badge,
    '  </header>',
    '  <article class="reddit-info-card flash-target"' + anchorAttr + '>',
    summary ? '    <p class="summary">' + escapeHtml(String(summary).slice(0, 320)) + '</p>' : '',
    top.length ? '    <dl class="kv-grid">' : '',
    top.map((f) => '      <div class="kv-row"><dt>' + escapeHtml(String(f.k)) + '</dt><dd>' + escapeHtml(String(f.v == null ? '' : f.v).slice(0, 200)) + '</dd></div>').join('\n'),
    top.length ? '    </dl>' : '',
    '  </article>',
    '</section>',
  ].filter(Boolean).join('\n');
}

function renderGenericRaw(label, payload, badge, anchorAttr){
  let raw = '';
  try {
    raw = JSON.stringify(payload, null, 2);
    if (raw.length > 4000) raw = raw.slice(0, 4000) + '\n… (' + (raw.length - 4000) + ' chars truncated) …';
  } catch (_) {
    raw = '[unserializable payload]';
  }
  return [
    '<section class="reddit-stage" data-kind="generic-raw">',
    '  <header class="reddit-stage-head">',
    '    <h2 class="sub-title">' + escapeHtml(label) + '</h2>',
    '    ' + badge,
    '  </header>',
    '  <article class="reddit-info-card flash-target"' + anchorAttr + '>',
    '    <p class="summary">这是 generic fallback 渲染：上游 skill 还没为该 (skillId, kind) 注册专属模板。</p>',
    '    <p class="empty-hint">用 <code>node packages/visual-replay-hyperframes/cli/jse-template-scaffold.js &lt;session-dir&gt;</code> 自动生成模板骨架。</p>',
    '    <details><summary class="empty-hint">raw payload</summary><pre style="font-size:11px;line-height:1.4;color:rgba(240,246,252,0.65);overflow:auto;max-height:380px;">' + escapeHtml(raw) + '</pre></details>',
    '  </article>',
    '</section>',
  ].join('\n');
}

function pickStr(obj, keys){
  if (!obj) return '';
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === 'string' && v.length) return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  }
  return '';
}

module.exports = renderGeneric;
