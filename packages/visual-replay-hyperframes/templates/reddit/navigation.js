'use strict';

const { escapeHtml } = require('../../lib/escape');

/**
 * reddit navigation 模板：from → to URL 过场。
 * payload shape：{ from, to, hint, label }
 */
function renderNavigation(ctx){
  const payload = (ctx && ctx.payload) || {};
  const from = String(payload.from || '').trim();
  const to = String(payload.to || '').trim() || (ctx && ctx.target) || '';
  const label = (ctx && ctx.label) || 'navigate';
  const subHint = String(payload.hint || 'page_will_reload');
  const anchorId = ctx && ctx.anchorId ? String(ctx.anchorId) : '';

  return [
    '<section class="reddit-stage" data-kind="navigation">',
    '  <article class="reddit-nav-card flash-target"' + (anchorId ? ' data-anchor-id="' + escapeHtml(anchorId) + '"' : '') + '>',
    '    <div class="nav-arrow" aria-hidden="true">→</div>',
    '    <div class="nav-pair">',
    '      <div class="nav-row">',
    '        <span class="nav-label">from</span>',
    '        <span class="nav-url">' + escapeHtml(truncateUrl(from)) + '</span>',
    '      </div>',
    '      <div class="nav-row to">',
    '        <span class="nav-label">to</span>',
    '        <span class="nav-url">' + escapeHtml(truncateUrl(to)) + '</span>',
    '      </div>',
    '    </div>',
    '    <footer class="nav-footer">',
    '      <span class="nav-tag">' + escapeHtml(subHint) + '</span>',
    '      <span class="nav-action">' + escapeHtml(label) + '</span>',
    '    </footer>',
    '  </article>',
    '</section>',
  ].join('\n');
}

function truncateUrl(u){
  const s = String(u || '');
  if (!s) return '(empty)';
  if (s.length <= 80) return s;
  return s.slice(0, 36) + '…' + s.slice(-40);
}

module.exports = renderNavigation;
