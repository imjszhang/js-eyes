'use strict';

const path = require('path');

const DEFAULT_WS_ENDPOINT = process.env.JS_EYES_SERVER_URL
  || process.env.JS_EYES_WS_URL
  || (process.env.JS_EYES_SERVER_HOST || process.env.JS_EYES_SERVER_PORT
        ? `ws://${process.env.JS_EYES_SERVER_HOST || 'localhost'}:${process.env.JS_EYES_SERVER_PORT || 18080}`
        : 'ws://localhost:18080');

const DEFAULT_PAGE = process.env.JS_X_DEFAULT_PAGE || 'home';

const SEARCH_PATH_RE = /^\/search(?:\/|\?|$)/i;
const POST_PATH_RE = /^\/[\w_]+\/status\/\d+/i;
const HOME_PATH_RE = /^\/(?:home\/?)?(?:\?|$)/i;
const COMPOSE_PATH_RE = /^\/(?:compose|messages|i\/|notifications|explore|settings|search|home)/i;
const PROFILE_PATH_RE = /^\/[\w_]+(?:\/(?:with_replies|media|likes|highlights|articles)?)?\/?(?:$|\?|#)/i;
const X_HOST_RE = /(?:^|\.)(?:x\.com|twitter\.com)$/i;

function _activeBoost(tab) { return tab && tab.is_active ? 1000 : 0; }

function _xPath(tab) {
  try {
    const u = new URL((tab && tab.url) || '');
    if (!X_HOST_RE.test(u.hostname)) return null;
    return { url: u, path: u.pathname };
  } catch (_) { return null; }
}

const PAGE_PROFILES = {
  search: {
    name: 'search',
    targetUrlFragment: 'x.com/search',
    bridgePath: path.join(__dirname, '..', 'bridges', 'search-bridge.js'),
    bridgeGlobal: '__jse_x_search__',
    routeLabel: '/search?q=...',
    description: 'X.com 搜索结果页',
    score(tab) {
      const r = _xPath(tab);
      if (!r) return 0;
      let s = 0;
      if (SEARCH_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  profile: {
    name: 'profile',
    targetUrlFragment: 'x.com/<username>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'profile-bridge.js'),
    bridgeGlobal: '__jse_x_profile__',
    routeLabel: '/<username>/[with_replies|media|likes]',
    description: 'X.com 用户主页',
    score(tab) {
      const r = _xPath(tab);
      if (!r) return 0;
      let s = 0;
      // profile 必须排除 /status/、/search、/home、/i/、/compose、/messages、/notifications、/explore、/settings
      if (PROFILE_PATH_RE.test(r.path)
          && !POST_PATH_RE.test(r.path)
          && !COMPOSE_PATH_RE.test(r.path)) {
        s += 500;
      } else {
        s += 50;
      }
      s += _activeBoost(tab);
      return s;
    },
  },
  post: {
    name: 'post',
    targetUrlFragment: 'x.com/<user>/status/<id>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'post-bridge.js'),
    bridgeGlobal: '__jse_x_post__',
    routeLabel: '/<user>/status/<id>',
    description: 'X.com 帖子详情页',
    score(tab) {
      const r = _xPath(tab);
      if (!r) return 0;
      let s = 0;
      if (POST_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  home: {
    name: 'home',
    targetUrlFragment: 'x.com/home',
    bridgePath: path.join(__dirname, '..', 'bridges', 'home-bridge.js'),
    bridgeGlobal: '__jse_x_home__',
    routeLabel: 'x.com / x.com/home',
    description: 'X.com 首页 Feed（For You / Following）',
    score(tab) {
      const r = _xPath(tab);
      if (!r) return 0;
      let s = 0;
      if (HOME_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
};

function getPageProfile(name) {
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
