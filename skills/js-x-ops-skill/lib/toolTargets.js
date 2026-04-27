'use strict';

/**
 * 把 X 工具参数翻译成"理想的浏览器 URL"（M3 INTERACTIVE 档位 navigate / READ 档位 createUrl 兜底）。
 *
 * READ 档位默认 navigateOnReuse=false，所以这些 URL 仅在
 *   1. 用户完全没有 X tab 时作为 createUrl
 *   2. INTERACTIVE 工具 navigate 时
 * 起作用。
 */

function safeSeg(value) {
  return encodeURIComponent(String(value || '').replace(/^\/+|\/+$/g, ''));
}

function _stripAt(name) {
  return String(name || '').replace(/^@/, '').trim();
}

function searchUrl(args) {
  const q = (args && args.keyword) || (args && args.q) || '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const sort = args && args.sort;
  if (sort === 'latest') params.set('f', 'live');
  else if (sort === 'media') params.set('f', 'image');
  // top 是默认，不需要 f
  const qs = params.toString();
  return `https://x.com/search${qs ? '?' + qs : ''}`;
}

function profileUrl(args) {
  const name = _stripAt((args && args.username) || (args && args.name));
  if (!name) return 'https://x.com/';
  const tab = (args && args.tab) || '';
  const tabSeg = tab && tab !== 'tweets' ? `${safeSeg(tab)}/` : '';
  return `https://x.com/${safeSeg(name)}/${tabSeg}`.replace(/\/+$/, '/');
}

function postUrl(args) {
  if (args && args.url) return String(args.url);
  const id = (args && args.tweetId) || (args && args.id);
  if (!id) return 'https://x.com/';
  const m = /\/status\/(\d+)/.exec(String(id));
  const tid = m ? m[1] : (/^\d{6,}$/.test(String(id)) ? String(id) : null);
  if (!tid) return 'https://x.com/';
  const user = (args && args.username) ? safeSeg(_stripAt(args.username)) : 'i';
  return `https://x.com/${user}/status/${tid}`;
}

function homeUrl(args) {
  // For You 即 / 或 /home，Following 即 /home（点 Following Tab）；URL 上无差异。
  return 'https://x.com/home';
}

module.exports = {
  searchUrl,
  profileUrl,
  postUrl,
  homeUrl,
};
