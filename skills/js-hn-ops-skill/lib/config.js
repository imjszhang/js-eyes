'use strict';

const path = require('path');

const DEFAULT_WS_ENDPOINT = process.env.JS_EYES_SERVER_URL
  || process.env.JS_EYES_WS_URL
  || (process.env.JS_EYES_SERVER_HOST || process.env.JS_EYES_SERVER_PORT
        ? `ws://${process.env.JS_EYES_SERVER_HOST || 'localhost'}:${process.env.JS_EYES_SERVER_PORT || 18080}`
        : 'ws://localhost:18080');

const DEFAULT_PAGE = process.env.JS_HN_DEFAULT_PAGE || 'front';

const HN_HOST_RE = /(?:^|\.)news\.ycombinator\.com$/i;

const FRONT_PATH_RE = /^\/(?:news|newest|best|show|ask|jobs)?\/?(?:$|\?|#)/i;
const ITEM_PATH_RE = /^\/item\/?$/i;
const USER_PATH_RE = /^\/user\/?$/i;

function _activeBoost(tab){ return tab && tab.is_active ? 1000 : 0; }

function _hnPath(tab){
  try {
    const u = new URL((tab && tab.url) || '');
    if (!HN_HOST_RE.test(u.hostname)) return null;
    return { url: u, path: u.pathname, search: u.search };
  } catch (_) { return null; }
}

const PAGE_PROFILES = {
  front: {
    name: 'front',
    targetUrlFragment: 'news.ycombinator.com/news',
    bridgePath: path.join(__dirname, '..', 'bridges', 'front-bridge.js'),
    bridgeGlobal: '__jse_hn_front__',
    routeLabel: '/news | /newest | /best | /show | /ask | /jobs',
    description: 'Hacker News 首页列表',
    score(tab){
      const r = _hnPath(tab);
      if (!r) return 0;
      let s = 0;
      if (FRONT_PATH_RE.test(r.path) && !ITEM_PATH_RE.test(r.path) && !USER_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  item: {
    name: 'item',
    targetUrlFragment: 'news.ycombinator.com/item?id=',
    bridgePath: path.join(__dirname, '..', 'bridges', 'item-bridge.js'),
    bridgeGlobal: '__jse_hn_item__',
    routeLabel: '/item?id=<id>',
    description: 'Hacker News 帖子详情 + 评论',
    score(tab){
      const r = _hnPath(tab);
      if (!r) return 0;
      let s = 0;
      if (ITEM_PATH_RE.test(r.path) && /[?&]id=\d+/i.test(r.search || '')) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  user: {
    name: 'user',
    targetUrlFragment: 'news.ycombinator.com/user?id=',
    bridgePath: path.join(__dirname, '..', 'bridges', 'user-bridge.js'),
    bridgeGlobal: '__jse_hn_user__',
    routeLabel: '/user?id=<name>',
    description: 'Hacker News 用户页',
    score(tab){
      const r = _hnPath(tab);
      if (!r) return 0;
      let s = 0;
      if (USER_PATH_RE.test(r.path) && /[?&]id=/i.test(r.search || '')) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  search: {
    name: 'search',
    targetUrlFragment: 'news.ycombinator.com (search via Algolia API)',
    bridgePath: path.join(__dirname, '..', 'bridges', 'search-bridge.js'),
    bridgeGlobal: '__jse_hn_search__',
    routeLabel: 'Algolia hn.algolia.com',
    description: 'Hacker News 搜索（Algolia API）',
    score(tab){
      const r = _hnPath(tab);
      if (!r) return 0;
      let s = 0;
      s += 50;
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
  HN_HOST_RE,
  FRONT_PATH_RE,
  ITEM_PATH_RE,
  USER_PATH_RE,
  getPageProfile,
};
