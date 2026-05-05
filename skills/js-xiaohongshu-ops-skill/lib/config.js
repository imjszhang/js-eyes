'use strict';

const path = require('path');

const DEFAULT_WS_ENDPOINT = process.env.JS_EYES_SERVER_URL
  || process.env.JS_EYES_WS_URL
  || (process.env.JS_EYES_SERVER_HOST || process.env.JS_EYES_SERVER_PORT
        ? `ws://${process.env.JS_EYES_SERVER_HOST || 'localhost'}:${process.env.JS_EYES_SERVER_PORT || 18080}`
        : 'ws://localhost:18080');

const DEFAULT_PAGE = process.env.JS_XHS_DEFAULT_PAGE || 'note';

const NOTE_PATH_RE = /^\/(?:explore|discovery\/item)\/[\w]+/i;
const SEARCH_PATH_RE = /^\/search_result(?:\/|\?|$)/i;
const USER_PATH_RE = /^\/user\/profile\/[\w]+/i;
const HOME_PATH_RE = /^\/(?:explore\/?)?(?:\?|$)/i;

const XHS_HOST_RE = /(?:^|\.)(?:xiaohongshu\.com|xhscdn\.com)$/i;
const XHS_SHORT_HOST_RE = /(?:^|\.)xhslink\.com$/i;

function _activeBoost(tab) { return tab && tab.is_active ? 1000 : 0; }

function _xhsPath(tab) {
  try {
    const u = new URL((tab && tab.url) || '');
    if (XHS_HOST_RE.test(u.hostname)) return { url: u, path: u.pathname, short: false };
    if (XHS_SHORT_HOST_RE.test(u.hostname)) return { url: u, path: u.pathname, short: true };
    return null;
  } catch (_) { return null; }
}

const PAGE_PROFILES = {
  note: {
    name: 'note',
    targetUrlFragment: 'xiaohongshu.com/explore/<id>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'note-bridge.js'),
    bridgeGlobal: '__jse_xhs_note__',
    routeLabel: '/explore/<id> | /discovery/item/<id>',
    description: '小红书笔记详情页',
    score(tab) {
      const r = _xhsPath(tab);
      if (!r) return 0;
      let s = 0;
      if (r.short) s += 100;
      else if (NOTE_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  search: {
    name: 'search',
    targetUrlFragment: 'xiaohongshu.com/search_result',
    bridgePath: path.join(__dirname, '..', 'bridges', 'search-bridge.js'),
    bridgeGlobal: '__jse_xhs_search__',
    routeLabel: '/search_result?keyword=...',
    description: '小红书搜索结果页',
    score(tab) {
      const r = _xhsPath(tab);
      if (!r || r.short) return 0;
      let s = 0;
      if (SEARCH_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  user: {
    name: 'user',
    targetUrlFragment: 'xiaohongshu.com/user/profile/<id>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'user-bridge.js'),
    bridgeGlobal: '__jse_xhs_user__',
    routeLabel: '/user/profile/<id>',
    description: '小红书用户主页',
    score(tab) {
      const r = _xhsPath(tab);
      if (!r || r.short) return 0;
      let s = 0;
      if (USER_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  home: {
    name: 'home',
    targetUrlFragment: 'xiaohongshu.com/explore',
    bridgePath: path.join(__dirname, '..', 'bridges', 'home-bridge.js'),
    bridgeGlobal: '__jse_xhs_home__',
    routeLabel: 'xiaohongshu.com / xiaohongshu.com/explore',
    description: '小红书探索流',
    score(tab) {
      const r = _xhsPath(tab);
      if (!r || r.short) return 0;
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

function isXhsHostname(hostname) {
  return XHS_HOST_RE.test(String(hostname || '')) || XHS_SHORT_HOST_RE.test(String(hostname || ''));
}

module.exports = {
  DEFAULT_WS_ENDPOINT,
  DEFAULT_PAGE,
  PAGE_PROFILES,
  getPageProfile,
  isXhsHostname,
  XHS_HOST_RE,
  XHS_SHORT_HOST_RE,
};
