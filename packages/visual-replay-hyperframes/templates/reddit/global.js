'use strict';

const { escapeHtml } = require('../../lib/escape');

/**
 * reddit global 模板：key/value field 卡（session-state / probe / state 等）。
 * payload shape：{ summary, fields: [{k,v}], extra }
 */
function renderGlobal(ctx){
  const payload = (ctx && ctx.payload) || {};
  const fields = Array.isArray(payload.fields) ? payload.fields.slice(0, 12) : [];
  const summary = String(payload.summary || '').slice(0, 240);
  const label = (ctx && ctx.label) || (ctx && ctx.hint && ctx.hint.label) || 'reddit info';
  const anchorId = ctx && ctx.anchorId ? String(ctx.anchorId) : '';

  return [
    '<section class="reddit-stage" data-kind="global">',
    '  <header class="reddit-stage-head">',
    '    <h2 class="sub-title">' + escapeHtml(label) + '</h2>',
    '  </header>',
    '  <article class="reddit-info-card flash-target"' + (anchorId ? ' data-anchor-id="' + escapeHtml(anchorId) + '"' : '') + '>',
    summary ? '    <p class="summary">' + escapeHtml(summary) + '</p>' : '',
    fields.length ? '    <dl class="kv-grid">' : '',
    fields.length ? fields.map((f) => '      <div class="kv-row"><dt>' + escapeHtml(f.k) + '</dt><dd>' + escapeHtml(String(f.v).slice(0, 120)) + '</dd></div>').join('\n') : '    <p class="empty-hint">payload is empty</p>',
    fields.length ? '    </dl>' : '',
    '  </article>',
    '</section>',
  ].filter(Boolean).join('\n');
}

module.exports = renderGlobal;
