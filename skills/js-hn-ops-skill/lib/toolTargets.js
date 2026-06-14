'use strict';

const FEED_PATHS = {
  top: '/news',
  new: '/newest',
  best: '/best',
  ask: '/ask',
  show: '/show',
  job: '/jobs',
};

function normalizeFeed(feed) {
  const f = String(feed || 'top').toLowerCase().trim();
  return FEED_PATHS[f] ? f : 'top';
}

function frontUrl(args) {
  args = args || {};
  const feed = normalizeFeed(args.feed);
  let path = FEED_PATHS[feed] || '/news';
  const page = args.page != null ? Number(args.page) : 1;
  if (Number.isFinite(page) && page > 1) path += '?p=' + Math.floor(page);
  return 'https://news.ycombinator.com' + path;
}

function itemUrl(args) {
  args = args || {};
  let id = args.itemId != null ? Number(args.itemId) : null;
  if (!Number.isFinite(id) && args.url) {
    const m = String(args.url).match(/[?&]id=(\d+)/);
    if (m) id = parseInt(m[1], 10);
  }
  if (Number.isFinite(id)) {
    return 'https://news.ycombinator.com/item?id=' + encodeURIComponent(String(Math.floor(id)));
  }
  return 'https://news.ycombinator.com/news';
}

function userUrl(args) {
  args = args || {};
  const userId = args.userId ? String(args.userId).trim() : '';
  if (!userId) return 'https://news.ycombinator.com/news';
  let url = 'https://news.ycombinator.com/user?id=' + encodeURIComponent(userId);
  const tab = String(args.tab || '').toLowerCase();
  if (tab === 'comments') url += '&sort=comments';
  return url;
}

module.exports = {
  normalizeFeed,
  frontUrl,
  itemUrl,
  userUrl,
};
