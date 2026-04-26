'use strict';

/**
 * 把工具参数翻译成"理想的浏览器 URL"（用于 M3 INTERACTIVE 档位 navigate，
 * 也可在 M2 READ 档位用作 createUrl 兜底）。
 *
 * 注意：READ 档位默认 navigateOnReuse=false，所以这些 URL 仅在
 *   1. 用户完全没有 reddit tab 时作为 createUrl
 *   2. INTERACTIVE 工具 navigate 时
 * 起作用。
 */

function safeSeg(value) {
  return encodeURIComponent(String(value || '').replace(/^\/+|\/+$/g, ''));
}

function listSubredditUrl(args) {
  const sub = (args && args.sub) || '';
  const sort = (args && args.sort) || 'hot';
  if (!sub) return 'https://www.reddit.com/';
  return `https://www.reddit.com/r/${safeSeg(sub)}/${safeSeg(sort)}/`;
}

function subredditAboutUrl(args) {
  const sub = (args && args.sub) || '';
  if (!sub) return 'https://www.reddit.com/';
  return `https://www.reddit.com/r/${safeSeg(sub)}/about/`;
}

function searchUrl(args) {
  const q = (args && args.q) || '';
  const sub = args && args.sub;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (args && args.sort) params.set('sort', args.sort);
  if (args && args.t) params.set('t', args.t);
  if (args && args.restrictSr) params.set('restrict_sr', '1');
  const path = sub ? `/r/${safeSeg(sub)}/search/` : '/search/';
  const qs = params.toString();
  return `https://www.reddit.com${path}${qs ? '?' + qs : ''}`;
}

function userProfileUrl(args) {
  const name = (args && args.name) || '';
  const tab = (args && args.tab) || '';
  if (!name) return 'https://www.reddit.com/';
  const tabSeg = tab ? `${safeSeg(tab)}/` : '';
  return `https://www.reddit.com/user/${safeSeg(name)}/${tabSeg}`;
}

function inboxListUrl(args) {
  const box = (args && args.box) || 'inbox';
  return `https://www.reddit.com/message/${safeSeg(box)}/`;
}

function myFeedUrl(args) {
  const feed = (args && args.feed) || 'home';
  const sort = (args && args.sort) || '';
  if (feed === 'home') {
    if (sort && sort !== 'best') return `https://www.reddit.com/${safeSeg(sort)}/`;
    return 'https://www.reddit.com/';
  }
  return `https://www.reddit.com/r/${safeSeg(feed)}/${sort ? safeSeg(sort) + '/' : ''}`;
}

function postUrl(args) {
  if (args && args.url) return String(args.url);
  if (args && args.permalink) {
    const p = String(args.permalink).replace(/^https?:\/\/[^/]+/i, '');
    return `https://www.reddit.com${p.startsWith('/') ? '' : '/'}${p}`;
  }
  return 'https://www.reddit.com/';
}

module.exports = {
  listSubredditUrl,
  subredditAboutUrl,
  searchUrl,
  userProfileUrl,
  inboxListUrl,
  myFeedUrl,
  postUrl,
};
