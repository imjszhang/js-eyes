'use strict';

const path = require('path');

const DEFAULT_WS_ENDPOINT = process.env.JS_EYES_SERVER_URL
  || process.env.JS_EYES_WS_URL
  || (process.env.JS_EYES_SERVER_HOST || process.env.JS_EYES_SERVER_PORT
    ? `ws://${process.env.JS_EYES_SERVER_HOST || 'localhost'}:${process.env.JS_EYES_SERVER_PORT || 18080}`
    : 'ws://localhost:18080');

const DEFAULT_PAGE = process.env.JS_ZHIHU_DEFAULT_PAGE || 'answer';

const ZHIHU_HOST_RE = /(?:^|\.)(?:zhihu\.com|zhuanlan\.zhihu\.com)$/i;
const ANSWER_PATH_RE = /^\/question\/\d+\/answer\/\d+/i;
const QUESTION_PATH_RE = /^\/question\/\d+(?:\/|$)/i;
const ARTICLE_PATH_RE = /^\/p\/\d+/i;
const SEARCH_PATH_RE = /^\/search(?:\/|\?|$)/i;
const USER_PATH_RE = /^\/(?:people|org)\/[^/?#]+/i;
const HOME_PATH_RE = /^\/(?:\?|$)/i;

function activeBoost(tab) {
  return tab && tab.is_active ? 1000 : 0;
}

function zhihuPath(tab) {
  try {
    const u = new URL((tab && tab.url) || '');
    if (!ZHIHU_HOST_RE.test(u.hostname)) return null;
    return { url: u, path: u.pathname, host: u.hostname };
  } catch (_) {
    return null;
  }
}

function scoreByPath(tab, matcher, baseScore = 500) {
  const r = zhihuPath(tab);
  if (!r) return 0;
  let score = matcher(r) ? baseScore : 50;
  score += activeBoost(tab);
  return score;
}

const PAGE_PROFILES = {
  answer: {
    name: 'answer',
    targetUrlFragment: 'zhihu.com/question/<questionId>/answer/<answerId>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'answer-bridge.js'),
    bridgeGlobal: '__jse_zhihu_answer__',
    routeLabel: '/question/<questionId>/answer/<answerId>',
    description: '知乎回答详情页',
    score(tab) {
      return scoreByPath(tab, (r) => ANSWER_PATH_RE.test(r.path));
    },
  },
  article: {
    name: 'article',
    targetUrlFragment: 'zhuanlan.zhihu.com/p/<articleId>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'article-bridge.js'),
    bridgeGlobal: '__jse_zhihu_article__',
    routeLabel: 'zhuanlan.zhihu.com/p/<articleId>',
    description: '知乎专栏文章页',
    score(tab) {
      return scoreByPath(tab, (r) => ARTICLE_PATH_RE.test(r.path));
    },
  },
  question: {
    name: 'question',
    targetUrlFragment: 'zhihu.com/question/<questionId>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'question-bridge.js'),
    bridgeGlobal: '__jse_zhihu_question__',
    routeLabel: '/question/<questionId>',
    description: '知乎问题页',
    score(tab) {
      return scoreByPath(tab, (r) => QUESTION_PATH_RE.test(r.path));
    },
  },
  search: {
    name: 'search',
    targetUrlFragment: 'zhihu.com/search',
    bridgePath: path.join(__dirname, '..', 'bridges', 'search-bridge.js'),
    bridgeGlobal: '__jse_zhihu_search__',
    routeLabel: '/search?q=...',
    description: '知乎搜索结果页',
    score(tab) {
      return scoreByPath(tab, (r) => SEARCH_PATH_RE.test(r.path));
    },
  },
  user: {
    name: 'user',
    targetUrlFragment: 'zhihu.com/people/<slug>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'user-bridge.js'),
    bridgeGlobal: '__jse_zhihu_user__',
    routeLabel: '/people/<slug> | /org/<slug>',
    description: '知乎用户主页',
    score(tab) {
      return scoreByPath(tab, (r) => USER_PATH_RE.test(r.path));
    },
  },
  home: {
    name: 'home',
    targetUrlFragment: 'zhihu.com',
    bridgePath: path.join(__dirname, '..', 'bridges', 'home-bridge.js'),
    bridgeGlobal: '__jse_zhihu_home__',
    routeLabel: 'zhihu.com',
    description: '知乎首页',
    score(tab) {
      return scoreByPath(tab, (r) => HOME_PATH_RE.test(r.path), 300);
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

function isZhihuHostname(hostname) {
  return ZHIHU_HOST_RE.test(String(hostname || ''));
}

module.exports = {
  DEFAULT_WS_ENDPOINT,
  DEFAULT_PAGE,
  PAGE_PROFILES,
  getPageProfile,
  isZhihuHostname,
  ZHIHU_HOST_RE,
};
