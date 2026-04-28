'use strict';

const path = require('path');

const DEFAULT_WS_ENDPOINT = process.env.JS_EYES_SERVER_URL
  || process.env.JS_EYES_WS_URL
  || (process.env.JS_EYES_SERVER_HOST || process.env.JS_EYES_SERVER_PORT
        ? `ws://${process.env.JS_EYES_SERVER_HOST || 'localhost'}:${process.env.JS_EYES_SERVER_PORT || 18080}`
        : 'ws://localhost:18080');

const DEFAULT_PAGE = process.env.JS_GITHUB_DEFAULT_PAGE || 'repo';

const GITHUB_HOST_RE = /(?:^|\.)github\.com$/i;

/** /owner/repo only (no extra path segments) */
const REPO_ROOT_RE = /^\/([^/]+)\/([^/]+)\/?$/;

/** /owner/repo/issues without issue number in path (query allowed on issues list) */
const ISSUES_LIST_PATH_RE = /^\/([^/]+)\/([^/]+)\/issues\/?$/;

/** /owner/repo/issues/123 */
const ISSUE_DETAIL_RE = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)/;

function _activeBoost(tab){ return tab && tab.is_active ? 1000 : 0; }

function _githubPath(tab){
  try {
    const u = new URL((tab && tab.url) || '');
    if (!GITHUB_HOST_RE.test(u.hostname)) return null;
    return { url: u, path: u.pathname };
  } catch (_) { return null; }
}

const PAGE_PROFILES = {
  repo: {
    name: 'repo',
    targetUrlFragment: 'github.com/<owner>/<repo>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'repo-bridge.js'),
    bridgeGlobal: '__jse_github_repo__',
    routeLabel: '/<owner>/<repo>',
    description: 'GitHub 仓库根路径',
    score(tab){
      const r = _githubPath(tab);
      if (!r) return 0;
      let s = 0;
      if (REPO_ROOT_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  issues: {
    name: 'issues',
    targetUrlFragment: 'github.com/<owner>/<repo>/issues',
    bridgePath: path.join(__dirname, '..', 'bridges', 'issues-bridge.js'),
    bridgeGlobal: '__jse_github_issues__',
    routeLabel: '/<owner>/<repo>/issues',
    description: 'GitHub Issues 列表',
    score(tab){
      const r = _githubPath(tab);
      if (!r) return 0;
      let s = 0;
      if (ISSUES_LIST_PATH_RE.test(r.path)) s += 500;
      else s += 50;
      s += _activeBoost(tab);
      return s;
    },
  },
  issue: {
    name: 'issue',
    targetUrlFragment: 'github.com/<owner>/<repo>/issues/<n>',
    bridgePath: path.join(__dirname, '..', 'bridges', 'issue-bridge.js'),
    bridgeGlobal: '__jse_github_issue__',
    routeLabel: '/<owner>/<repo>/issues/<number>',
    description: 'GitHub 单条 Issue',
    score(tab){
      const r = _githubPath(tab);
      if (!r) return 0;
      let s = 0;
      if (ISSUE_DETAIL_RE.test(r.path)) s += 500;
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
  GITHUB_HOST_RE,
  REPO_ROOT_RE,
  ISSUES_LIST_PATH_RE,
  ISSUE_DETAIL_RE,
  getPageProfile,
};
