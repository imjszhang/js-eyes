'use strict';

const path = require('path');
const { detectVerticalFromUrl, isScholarHost, isSearchHost } = require('./serp/parsers');

const DEFAULT_WS_ENDPOINT = process.env.JS_EYES_SERVER_URL
  || process.env.JS_EYES_WS_URL
  || (process.env.JS_EYES_SERVER_HOST || process.env.JS_EYES_SERVER_PORT
        ? `ws://${process.env.JS_EYES_SERVER_HOST || 'localhost'}:${process.env.JS_EYES_SERVER_PORT || 18080}`
        : 'ws://localhost:18080');

const DEFAULT_PAGE = process.env.JS_GOOGLE_DEFAULT_PAGE || 'search';

function _activeBoost(tab) {
  return tab && tab.is_active ? 1000 : 0;
}

function _tabUrl(tab) {
  try {
    return new URL((tab && tab.url) || '');
  } catch (_) {
    return null;
  }
}

const PAGE_PROFILES = {
  search: {
    name: 'search',
    targetUrlFragment: 'www.google.com/search',
    bridgePath: path.join(__dirname, '..', 'bridges', 'search-bridge.js'),
    bridgeGlobal: '__jse_google_search__',
    routeLabel: '/search?q=… (web|news|images)',
    description: 'Google Web / News / Images 搜索结果页',
    score(tab) {
      const u = _tabUrl(tab);
      if (!u || !isSearchHost(u.hostname)) return 0;
      let s = 50;
      const vertical = detectVerticalFromUrl(u.toString());
      if (u.pathname === '/search' || u.pathname === '/search/') s += 500;
      if (vertical === 'web' || vertical === 'news' || vertical === 'images') s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  scholar: {
    name: 'scholar',
    targetUrlFragment: 'scholar.google.com/scholar',
    bridgePath: path.join(__dirname, '..', 'bridges', 'scholar-bridge.js'),
    bridgeGlobal: '__jse_google_scholar__',
    routeLabel: 'scholar.google.com/scholar?q=…',
    description: 'Google Scholar 搜索结果页',
    score(tab) {
      const u = _tabUrl(tab);
      if (!u || !isScholarHost(u.hostname)) return 0;
      let s = 50;
      if (u.pathname === '/scholar' || u.pathname === '/scholar/') s += 500;
      s += _activeBoost(tab);
      return s;
    },
  },
};

function getPageProfile(name) {
  const key = name || DEFAULT_PAGE;
  const profile = PAGE_PROFILES[key];
  if (!profile) {
    const err = new Error(`未知 page profile: ${key}；可选: ${Object.keys(PAGE_PROFILES).join(' | ')}`);
    err.code = 'E_BAD_ARG';
    throw err;
  }
  return profile;
}

function isGoogleTab(tab) {
  const u = _tabUrl(tab);
  if (!u) return false;
  return isSearchHost(u.hostname) || isScholarHost(u.hostname);
}

module.exports = {
  DEFAULT_WS_ENDPOINT,
  DEFAULT_PAGE,
  PAGE_PROFILES,
  getPageProfile,
  isGoogleTab,
};
