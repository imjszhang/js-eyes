// bridges/issue-bridge.js
(function install(){
  'use strict';
  const VERSION = '0.1.0';

  // @@include ./common.js

  async function probe(){
    const p = parseIssueDetailPath(location.pathname || '');
    const login = readLoginMeta();
    return okResult({
      url: location.href,
      owner: p.owner,
      repo: p.repo,
      number: p.number,
      login: { loggedIn: !!login.loggedIn, name: login.name, source: login.source },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'issue-bridge' },
    });
  }

  async function state(){
    const p = parseIssueDetailPath(location.pathname || '');
    return okResult({
      ready: !!(p.owner && p.repo && p.number != null),
      reason: (p.owner && p.repo && p.number != null) ? null : 'not_on_issue_detail',
      url: location.href,
      owner: p.owner,
      repo: p.repo,
      number: p.number,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function getIssue(args){
    args = args || {};
    let { owner, repo } = normalizeOwnerRepoArgs(args);
    let num = args.number != null ? Number(args.number) : null;
    if (!owner || !repo || !Number.isFinite(num)) {
      const p = parseIssueDetailPath(location.pathname || '');
      owner = owner || p.owner || '';
      repo = repo || p.repo || '';
      if (num == null || !Number.isFinite(num)) num = p.number;
    }
    owner = String(owner).trim();
    repo = String(repo).trim();
    num = Number(num);
    if (!owner || !repo || !Number.isFinite(num) || num <= 0) {
      return errResult('missing_owner_repo_number', { hint: '传 owner+repo+number 或在 issue 页执行' });
    }

    const path = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/issues/' + encodeURIComponent(String(Math.floor(num)));
    const t0 = Date.now();
    const resp = await fetchGithubApi(path, { textLimit: 2048 });
    if (!resp.ok || !resp.data || resp.data._nonJson) {
      let msg = null;
      if (resp.data && !resp.data._nonJson && typeof resp.data.message === 'string') msg = resp.data.message;
      return errResult('fetch_failed', {
        httpStatus: resp.httpStatus || null,
        url: resp.url || null,
        message: msg,
      });
    }
    const detail = summarizeIssueDetail(resp.data, args.bodyMaxLen || 12000);
    return okResult({
      owner,
      repo,
      issue: detail,
      meta: {
        bridge: 'issue-bridge',
        version: VERSION,
        endpoint: resp.url,
        httpStatus: resp.httpStatus,
        fetchDurationMs: Date.now() - t0,
      },
    });
  }

  function navigateIssue(args){
    args = args || {};
    let { owner, repo } = normalizeOwnerRepoArgs(args);
    let num = args.number != null ? Number(args.number) : null;
    if (!owner || !repo || !Number.isFinite(num)) {
      const p = parseIssueDetailPath(location.pathname || '');
      owner = owner || p.owner || '';
      repo = repo || p.repo || '';
      if (num == null || !Number.isFinite(num)) num = p.number;
    }
    owner = String(owner).trim();
    repo = String(repo).trim();
    num = Number(num);
    if (!owner || !repo || !Number.isFinite(num) || num <= 0) return errResult('missing_owner_repo_number');
    const url = 'https://github.com/'
      + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/issues/' + encodeURIComponent(String(Math.floor(num)));
    return navigateLocation(url);
  }

  const api = {
    __meta: { version: VERSION, name: 'issue-bridge' },
    probe,
    state,
    sessionState,
    getIssue,
    navigateIssue,
  };
  window.__jse_github_issue__ = api;
  return { ok: true, version: VERSION, name: 'issue-bridge' };
})();
