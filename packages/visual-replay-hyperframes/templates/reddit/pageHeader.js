'use strict';

// templates/reddit/pageHeader.js
// ---------------------------------------------------------------------------
// v0.3.0 reddit page shell：每张卡片专属的 page header（sub banner / sort tabs /
// search results header / nav breadcrumb / user dropdown）。
//
// renderPageHeader(ctx) 接受
//   ctx.toolName    - reddit_search / reddit_list_subreddit / reddit_subreddit_about / ...
//   ctx.payload     - bridge 抽出的 payload（含 sub / sort / target / fields ...）
//   ctx.hint        - { kind, label, anchor, target, skillId }
//   ctx.label       - 短标题（从 hint 来）
//
// 返回 HTML 字符串。返回空表示不渲（直接进 stage 主体），用于 reddit-ops 之外的
// skill 或不期望特殊 chrome 的工具调用。
// ---------------------------------------------------------------------------

const { escapeHtml } = require('../../lib/escape');

const SUB_TABS = [
  { id: 'hot',           label: 'Hot' },
  { id: 'new',           label: 'New' },
  { id: 'top',           label: 'Top' },
  { id: 'rising',        label: 'Rising' },
];

const SEARCH_TYPE_TABS = [
  { id: 'link',          label: 'Posts' },
  { id: 'comment',       label: 'Comments' },
  { id: 'sr',            label: 'Communities' },
  { id: 'user',          label: 'People' },
];

const SEARCH_SORT_TABS = [
  { id: 'relevance',     label: 'Relevance' },
  { id: 'hot',           label: 'Hot' },
  { id: 'top',           label: 'Top' },
  { id: 'new',           label: 'New' },
  { id: 'comments',      label: 'Comments' },
];

function renderPageHeader(ctx){
  const c = ctx || {};
  const toolName = String(c.toolName || (c.hint && c.hint.toolName) || '').trim();
  if (!toolName) return '';

  switch (toolName) {
    case 'reddit_search':         return renderSearchHeader(c);
    case 'reddit_subreddit_about':return renderSubAboutHeader(c);
    case 'reddit_list_subreddit': return renderSubListHeader(c);
    case 'reddit_user_profile':   return renderUserHeader(c);
    case 'reddit_session_state':  return renderSessionHeader(c);
    case 'reddit_inbox_list':     return renderInboxHeader(c);
    case 'reddit_my_feed':        return renderFeedHeader(c);
    case 'reddit_navigate_post':
    case 'reddit_navigate_subreddit':
    case 'reddit_navigate_search':
    case 'reddit_navigate_user':
    case 'reddit_navigate_inbox':
    case 'reddit_navigate_home':  return renderNavHeader(c);
    default:                       return '';
  }
}

// ---- search ---------------------------------------------------------------
function renderSearchHeader(ctx){
  const payload = ctx.payload || {};
  const query = String(payload.target || ctx.label || '').replace(/^搜索\s*"?|"?$/g, '').trim();
  const sub = String(payload.sub || (ctx.hint && ctx.hint.anchor && ctx.hint.anchor.subreddit) || '');
  const sort = String(payload.sort || 'relevance').toLowerCase();
  const total = Number.isFinite(payload.totalCount) ? payload.totalCount : (Array.isArray(payload.items) ? payload.items.length : 0);
  const scope = sub ? ('in r/' + sub) : 'across reddit';

  return [
    '<header class="reddit-page-header" data-page-kind="search">',
    '  <div class="page-banner page-banner-search">',
    '    <span class="banner-eyebrow">Search</span>',
    '    <h1 class="banner-title">"' + escapeHtml(query || '...') + '"</h1>',
    '    <p class="banner-meta">' + escapeHtml(String(total)) + ' results · ' + escapeHtml(scope) + '</p>',
    '  </div>',
    '  <nav class="sort-tabs sort-tabs-type" aria-label="Search type">',
    SEARCH_TYPE_TABS.map((t) => {
      // search-ops 默认 type=link → Posts active
      const active = (t.id === 'link');
      return '    <span class="pill' + (active ? ' active' : '') + '" data-tab-type="' + escapeHtml(t.id) + '">' + escapeHtml(t.label) + '</span>';
    }).join('\n'),
    '  </nav>',
    '  <nav class="sort-tabs sort-tabs-sort" aria-label="Sort" data-sort-current="' + escapeHtml(sort) + '">',
    SEARCH_SORT_TABS.map((t) => {
      const active = t.id === sort;
      return '    <span class="pill' + (active ? ' active' : '') + '" data-tab-sort="' + escapeHtml(t.id) + '">' + escapeHtml(t.label) + '</span>';
    }).join('\n'),
    '  </nav>',
    '</header>',
  ].join('\n');
}

// ---- subreddit-about ------------------------------------------------------
function renderSubAboutHeader(ctx){
  const payload = ctx.payload || {};
  const sub = pickSubName(ctx);
  const subscribers = pickField(payload.fields, ['subscribers', 'subscriberCount']);
  const created = pickField(payload.fields, ['created', 'createdISO']);

  return [
    '<header class="reddit-page-header" data-page-kind="sub-about">',
    '  ' + renderSubBanner(sub, { showJoined: true, badgeText: 'About community' }),
    '  <div class="page-banner-meta">',
    subscribers ? '    <span class="meta-pill"><strong>' + escapeHtml(subscribers) + '</strong> members</span>' : '',
    created ? '    <span class="meta-pill">Created ' + escapeHtml(String(created).slice(0, 10)) + '</span>' : '',
    '    <span class="meta-pill">Public</span>',
    '  </div>',
    '</header>',
  ].filter(Boolean).join('\n');
}

// ---- list-subreddit -------------------------------------------------------
function renderSubListHeader(ctx){
  const payload = ctx.payload || {};
  const sub = pickSubName(ctx);
  const sort = String(payload.sort || 'hot').toLowerCase();

  return [
    '<header class="reddit-page-header" data-page-kind="sub-list">',
    '  ' + renderSubBanner(sub, { showJoined: true }),
    '  <nav class="sort-tabs sort-tabs-sub" aria-label="Sort" data-sort-current="' + escapeHtml(sort) + '">',
    SUB_TABS.map((t) => {
      const active = t.id === sort;
      return '    <span class="pill' + (active ? ' active' : '') + '" data-tab-sort="' + escapeHtml(t.id) + '">' + escapeHtml(t.label) + '</span>';
    }).join('\n'),
    '  </nav>',
    '</header>',
  ].join('\n');
}

// ---- user profile ---------------------------------------------------------
function renderUserHeader(ctx){
  const payload = ctx.payload || {};
  const name = String(payload.user || (ctx.hint && ctx.hint.anchor && ctx.hint.anchor.user) || pickField(payload.fields, ['name', 'username']) || '?').replace(/^u\//, '');
  const tab = String(payload.tab || 'overview').toLowerCase();
  const tabs = ['overview', 'posts', 'comments', 'saved'];

  return [
    '<header class="reddit-page-header" data-page-kind="user">',
    '  <div class="user-banner">',
    '    <span class="user-avatar">' + escapeHtml(name.slice(0, 1).toUpperCase()) + '</span>',
    '    <div class="user-meta">',
    '      <h1 class="user-name">u/' + escapeHtml(name) + '</h1>',
    '      <p class="user-sub">Reddit profile</p>',
    '    </div>',
    '    <button class="banner-cta" type="button" tabindex="-1">Follow</button>',
    '  </div>',
    '  <nav class="sort-tabs sort-tabs-user" aria-label="Profile tab" data-sort-current="' + escapeHtml(tab) + '">',
    tabs.map((t) => '    <span class="pill' + (t === tab ? ' active' : '') + '" data-tab-sort="' + escapeHtml(t) + '">' + escapeHtml(t.charAt(0).toUpperCase() + t.slice(1)) + '</span>').join('\n'),
    '  </nav>',
    '</header>',
  ].join('\n');
}

// ---- session-state --------------------------------------------------------
function renderSessionHeader(ctx){
  const payload = ctx.payload || {};
  const username = pickField(payload.fields, ['name', 'username']) || 'researcher';
  const totalKarma = pickField(payload.fields, ['totalKarma', 'total_karma']);

  return [
    '<header class="reddit-page-header" data-page-kind="session">',
    '  <div class="user-dropdown">',
    '    <span class="user-avatar large">' + escapeHtml(String(username).slice(0, 1).toUpperCase()) + '</span>',
    '    <div class="user-dropdown-meta">',
    '      <p class="user-status"><span class="status-dot"></span> Logged in as</p>',
    '      <h1 class="user-name">u/' + escapeHtml(username) + '</h1>',
    totalKarma ? '      <p class="user-karma">' + escapeHtml(String(totalKarma)) + ' karma</p>' : '',
    '    </div>',
    '  </div>',
    '</header>',
  ].filter(Boolean).join('\n');
}

// ---- inbox ----------------------------------------------------------------
function renderInboxHeader(ctx){
  const payload = ctx.payload || {};
  const box = String(payload.box || (ctx.hint && ctx.hint.target) || 'inbox').toLowerCase();
  const tabs = [
    { id: 'inbox',     label: 'Inbox' },
    { id: 'unread',    label: 'Unread' },
    { id: 'messages',  label: 'Messages' },
    { id: 'sent',      label: 'Sent' },
  ];
  return [
    '<header class="reddit-page-header" data-page-kind="inbox">',
    '  <div class="page-banner page-banner-inbox">',
    '    <span class="banner-eyebrow">Inbox</span>',
    '    <h1 class="banner-title">Messages &amp; replies</h1>',
    '  </div>',
    '  <nav class="sort-tabs sort-tabs-inbox" aria-label="Inbox box" data-sort-current="' + escapeHtml(box) + '">',
    tabs.map((t) => '    <span class="pill' + (t.id === box ? ' active' : '') + '" data-tab-sort="' + escapeHtml(t.id) + '">' + escapeHtml(t.label) + '</span>').join('\n'),
    '  </nav>',
    '</header>',
  ].join('\n');
}

// ---- my-feed --------------------------------------------------------------
function renderFeedHeader(ctx){
  const payload = ctx.payload || {};
  const feed = String(payload.feed || 'home').toLowerCase();
  const sort = String(payload.sort || 'best').toLowerCase();
  const tabs = [
    { id: 'best',   label: 'Best' },
    { id: 'hot',    label: 'Hot' },
    { id: 'new',    label: 'New' },
    { id: 'top',    label: 'Top' },
    { id: 'rising', label: 'Rising' },
  ];
  return [
    '<header class="reddit-page-header" data-page-kind="my-feed">',
    '  <div class="page-banner page-banner-feed">',
    '    <span class="banner-eyebrow">Feed</span>',
    '    <h1 class="banner-title">' + escapeHtml(feed.charAt(0).toUpperCase() + feed.slice(1)) + '</h1>',
    '  </div>',
    '  <nav class="sort-tabs sort-tabs-feed" aria-label="Feed sort" data-sort-current="' + escapeHtml(sort) + '">',
    tabs.map((t) => '    <span class="pill' + (t.id === sort ? ' active' : '') + '" data-tab-sort="' + escapeHtml(t.id) + '">' + escapeHtml(t.label) + '</span>').join('\n'),
    '  </nav>',
    '</header>',
  ].join('\n');
}

// ---- navigation -----------------------------------------------------------
function renderNavHeader(ctx){
  const payload = ctx.payload || {};
  const from = String(payload.from || '');
  const to = String(payload.to || (ctx.hint && ctx.hint.target) || '');
  return [
    '<header class="reddit-page-header" data-page-kind="nav">',
    '  <div class="nav-breadcrumb">',
    '    <span class="nav-tag">Navigate</span>',
    from ? '    <code class="nav-from">' + escapeHtml(truncateUrl(from)) + '</code>' : '',
    '    <span class="nav-arrow">&rarr;</span>',
    '    <code class="nav-to">' + escapeHtml(truncateUrl(to || '?')) + '</code>',
    '  </div>',
    '</header>',
  ].filter(Boolean).join('\n');
}

// ---- helpers --------------------------------------------------------------
function renderSubBanner(subName, opts){
  const o = opts || {};
  const safeName = String(subName || '').replace(/^r\//, '');
  const initial = safeName.slice(0, 1).toUpperCase() || 'r';
  return [
    '<div class="sub-banner">',
    '  <span class="sub-icon">' + escapeHtml(initial) + '</span>',
    '  <div class="sub-meta">',
    '    <h1 class="sub-name">r/' + escapeHtml(safeName || '?') + '</h1>',
    o.badgeText ? '    <span class="sub-badge">' + escapeHtml(o.badgeText) + '</span>' : '',
    '  </div>',
    o.showJoined ? '  <button class="banner-cta" type="button" tabindex="-1">Joined</button>' : '',
    '</div>',
  ].filter(Boolean).join('\n');
}

function pickSubName(ctx){
  const payload = ctx.payload || {};
  if (payload.sub) return String(payload.sub).replace(/^r\//, '');
  if (ctx.hint && ctx.hint.anchor && ctx.hint.anchor.subreddit) return String(ctx.hint.anchor.subreddit);
  if (payload.target) {
    const m = /^r\/([\w-]+)/.exec(String(payload.target));
    if (m) return m[1];
  }
  if (ctx.hint && ctx.hint.target) {
    const m = /^r\/([\w-]+)/.exec(String(ctx.hint.target));
    if (m) return m[1];
  }
  return '';
}

function pickField(fields, keys){
  if (!Array.isArray(fields)) return '';
  for (const k of keys) {
    for (const f of fields) {
      if (f && f.k === k && f.v != null) return String(f.v);
    }
  }
  return '';
}

function truncateUrl(u){
  if (!u) return '';
  const s = String(u);
  if (s.length <= 80) return s;
  return s.slice(0, 50) + '...' + s.slice(-24);
}

module.exports = {
  renderPageHeader,
};
