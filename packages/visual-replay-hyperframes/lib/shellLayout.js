'use strict';

// lib/shellLayout.js
// ---------------------------------------------------------------------------
// v0.3.0 reddit page shell：常驻 chrome（topbar + leftnav）。这里的 HTML 是
// 一份给整个 composition 用的 layout 外壳，translator.buildHtml 会把它输出在
// <main id="stage"> 外层，跨所有卡片不变。
//
// 设计：
//   - topbar 是 sticky 顶栏，含风格化 reddit logo (inline SVG，不直接拷商标)、
//     一个 search input（[data-shell-search]，timelineScript 在 search 卡 active
//     时填 value）、Create 按钮 + 用户头像
//   - leftnav 240px 左栏，分两段：
//     · FEEDS 固定 Home/Popular/All（仅装饰）
//     · COMMUNITIES 动态：本会话访问过的 sub 列表（来自 buildRedditShell({ communities })），
//       每项 [data-shell-sub="<name>"]，timelineScript 当前 active card 的 sub 高亮
//   - 风格化 reddit 配色（#ff4500 调暗为 #d93900），不直接拷 reddit logo / 字
//     形配置，避免商标风险
// ---------------------------------------------------------------------------

const { escapeHtml } = require('./escape');

const REDDIT_LOGO_SVG = [
  '<svg class="brand-logo" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">',
  '  <circle cx="16" cy="16" r="14" fill="#d93900"></circle>',
  '  <text x="16" y="22" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, system-ui, sans-serif" font-size="18" font-weight="900" fill="#ffffff">r</text>',
  '</svg>',
].join('\n');

const FEEDS = [
  { id: 'home',     icon: '\u2302',         label: 'Home' },
  { id: 'popular',  icon: '\u2606',         label: 'Popular' },
  { id: 'all',      icon: '\u26AC',         label: 'All' },
];

/**
 * @param {object} [opts]
 * @param {string[]} [opts.communities] 本会话访问过的 sub 名（按首次出现顺序、去重）
 * @param {string} [opts.username] 已登录用户名占位（默认 'researcher'，不展露真实账号）
 * @returns {string} HTML 片段，供 translator.buildHtml 嵌入 #reddit-shell 内
 */
function buildRedditShell(opts){
  const o = opts || {};
  const communities = Array.isArray(o.communities) ? o.communities.slice(0, 12) : [];
  const username = String(o.username || 'researcher');

  const topbar = [
    '<header class="reddit-topbar" role="banner">',
    '  <a class="brand" href="#" tabindex="-1">',
    '    ' + REDDIT_LOGO_SVG,
    '    <span class="brand-name">reddit</span>',
    '  </a>',
    '  <div class="topbar-search-wrap">',
    '    <span class="topbar-search-icon" aria-hidden="true">\u2315</span>',
    '    <input class="topbar-search" type="text" data-shell-search placeholder="Search Reddit" autocomplete="off" tabindex="-1" />',
    '  </div>',
    '  <div class="topbar-actions">',
    '    <button class="topbar-create" type="button" tabindex="-1">',
    '      <span class="create-glyph" aria-hidden="true">+</span>',
    '      <span class="create-label">Create</span>',
    '    </button>',
    '    <span class="topbar-avatar" title="' + escapeHtml(username) + '">',
    '      <span class="avatar-dot"></span>',
    '      <span class="avatar-name">' + escapeHtml(username) + '</span>',
    '    </span>',
    '  </div>',
    '</header>',
  ].join('\n');

  const feedsList = FEEDS.map((f) => [
    '    <a class="leftnav-item" data-shell-feed="' + escapeHtml(f.id) + '" tabindex="-1">',
    '      <span class="leftnav-icon" aria-hidden="true">' + escapeHtml(f.icon) + '</span>',
    '      <span class="leftnav-label">' + escapeHtml(f.label) + '</span>',
    '    </a>',
  ].join('\n')).join('\n');

  const communitiesList = communities.length === 0
    ? '    <p class="leftnav-empty">No communities yet</p>'
    : communities.map((sub) => {
        const name = String(sub || '').replace(/^r\//, '');
        return [
          '    <a class="leftnav-item leftnav-sub" data-shell-sub="' + escapeHtml(name) + '" tabindex="-1">',
          '      <span class="leftnav-sub-icon" aria-hidden="true">' + escapeHtml(name.slice(0, 1).toUpperCase() || 'r') + '</span>',
          '      <span class="leftnav-label">r/' + escapeHtml(name) + '</span>',
          '    </a>',
        ].join('\n');
      }).join('\n');

  const leftnav = [
    '<aside class="reddit-leftnav" role="navigation" aria-label="Communities">',
    '  <div class="leftnav-section leftnav-feeds">',
    '    <h3 class="leftnav-heading">Feeds</h3>',
    feedsList,
    '  </div>',
    '  <div class="leftnav-section leftnav-communities" data-shell-communities>',
    '    <h3 class="leftnav-heading">Communities</h3>',
    communitiesList,
    '  </div>',
    '  <div class="leftnav-section leftnav-footer">',
    '    <p class="leftnav-foot-line">jse-replay · session shell</p>',
    '  </div>',
    '</aside>',
  ].join('\n');

  return { topbar, leftnav };
}

module.exports = {
  buildRedditShell,
  REDDIT_LOGO_SVG,
};
