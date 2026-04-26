'use strict';

const path = require('path');

const DEFAULT_WS_ENDPOINT = process.env.JS_EYES_SERVER_URL
  || process.env.JS_EYES_WS_URL
  || (process.env.JS_EYES_SERVER_HOST || process.env.JS_EYES_SERVER_PORT
        ? `ws://${process.env.JS_EYES_SERVER_HOST || 'localhost'}:${process.env.JS_EYES_SERVER_PORT || 18080}`
        : 'ws://localhost:18080');

const DEFAULT_PAGE = process.env.JS_REDDIT_DEFAULT_PAGE || 'post';

const POST_PATH_RE = /\/r\/[^/]+\/comments\//i;
const SUB_PATH_RE = /^\/r\/[^/]+(?:\/(?:hot|new|top|rising|controversial|wiki|about)?)?\/?(?:$|\?|#)/i;
const SEARCH_PATH_RE = /^\/(?:r\/[^/]+\/)?search(?:\/|\?|$)/i;
const USER_PATH_RE = /^\/user\/[\w-]+(?:\/[^/]*)?\/?(?:$|\?|#)/i;
const INBOX_PATH_RE = /^\/message(?:\/|$)/i;
const HOME_PATH_RE = /^\/(?:r\/(?:popular|all|home)\/?)?$/i;
const REDDIT_HOST_RE = /(?:^|\.)reddit\.com$/i;

function _activeBoost(tab){ return tab && tab.is_active ? 1000 : 0; }
function _redditPath(tab){
  try {
    const u = new URL((tab && tab.url) || '');
    if (!REDDIT_HOST_RE.test(u.hostname)) return null;
    return { url: u, path: u.pathname };
  } catch (_) { return null; }
}

const PAGE_PROFILES = {
  post: {
    name: 'post',
    targetUrlFragment: 'reddit.com/<sub>/comments/<id>/',
    bridgePath: path.join(__dirname, '..', 'bridges', 'post-bridge.js'),
    bridgeGlobal: '__jse_reddit_post__',
    routeLabel: '/r/<sub>/comments/<id>/',
    description: 'Reddit 帖子详情页',
    score(tab){
      const r = _redditPath(tab);
      if (!r) return 0;
      let s = 0;
      if (POST_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  subreddit: {
    name: 'subreddit',
    targetUrlFragment: 'reddit.com/r/<sub>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'listing-bridge.js'),
    bridgeGlobal: '__jse_reddit_listing__',
    routeLabel: '/r/<sub>/<sort>/',
    description: 'Reddit subreddit 列表页（hot/new/top/rising 等）',
    score(tab){
      const r = _redditPath(tab);
      if (!r) return 0;
      let s = 0;
      if (SUB_PATH_RE.test(r.path) && !POST_PATH_RE.test(r.path) && !HOME_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  search: {
    name: 'search',
    targetUrlFragment: 'reddit.com/search',
    bridgePath: path.join(__dirname, '..', 'bridges', 'search-bridge.js'),
    bridgeGlobal: '__jse_reddit_search__',
    routeLabel: '/search?q=...',
    description: 'Reddit 搜索结果页',
    score(tab){
      const r = _redditPath(tab);
      if (!r) return 0;
      let s = 0;
      if (SEARCH_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  user: {
    name: 'user',
    targetUrlFragment: 'reddit.com/user/<name>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'user-bridge.js'),
    bridgeGlobal: '__jse_reddit_user__',
    routeLabel: '/user/<name>/<tab>/',
    description: 'Reddit 用户主页',
    score(tab){
      const r = _redditPath(tab);
      if (!r) return 0;
      let s = 0;
      if (USER_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  inbox: {
    name: 'inbox',
    targetUrlFragment: 'reddit.com/message/',
    bridgePath: path.join(__dirname, '..', 'bridges', 'inbox-bridge.js'),
    bridgeGlobal: '__jse_reddit_inbox__',
    routeLabel: '/message/<box>/',
    description: 'Reddit 收件箱（需要登录）',
    score(tab){
      const r = _redditPath(tab);
      if (!r) return 0;
      let s = 0;
      if (INBOX_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  home: {
    name: 'home',
    targetUrlFragment: 'reddit.com/',
    bridgePath: path.join(__dirname, '..', 'bridges', 'home-bridge.js'),
    bridgeGlobal: '__jse_reddit_home__',
    routeLabel: 'reddit.com / /r/popular / /r/all / /r/home',
    description: 'Reddit 首页 / popular / all',
    score(tab){
      const r = _redditPath(tab);
      if (!r) return 0;
      let s = 0;
      if (HOME_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
};

function getPageProfile(name){
  const key = name || DEFAULT_PAGE;
  const profile = PAGE_PROFILES[key];
  if (!profile) {
    const err = new Error(
      `未知 page profile: ${key}；可选: ${Object.keys(PAGE_PROFILES).join(' | ')}`,
    );
    err.code = 'E_BAD_ARG';
    throw err;
  }
  return profile;
}

module.exports = {
  DEFAULT_WS_ENDPOINT,
  DEFAULT_PAGE,
  PAGE_PROFILES,
  getPageProfile,
};
