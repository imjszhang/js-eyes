// bridges/repo-bridge.js
(function install(){
  'use strict';
  const VERSION = '0.1.0';

  // @@include ./common.js

  async function probe(){
    const rp = parseRepoRootPath(location.pathname || '');
    const login = readLoginMeta();
    return okResult({
      url: location.href,
      owner: rp.owner,
      repo: rp.repo,
      login: { loggedIn: !!login.loggedIn, name: login.name, source: login.source },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'repo-bridge' },
    });
  }

  async function state(){
    const rp = parseRepoRootPath(location.pathname || '');
    return okResult({
      ready: !!(rp.owner && rp.repo),
      reason: (rp.owner && rp.repo) ? null : 'not_on_repo_root',
      url: location.href,
      owner: rp.owner,
      repo: rp.repo,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function getRepo(args){
    args = args || {};
    let { owner, repo } = normalizeOwnerRepoArgs(args);
    if (!owner || !repo) {
      const rp = parseRepoRootPath(location.pathname || '');
      owner = owner || rp.owner || '';
      repo = repo || rp.repo || '';
    }
    owner = String(owner).trim();
    repo = String(repo).trim();
    if (!owner || !repo) return errResult('missing_owner_repo', { hint: '传 owner+repo 或在 /<owner>/<repo> 页执行' });

    const t0 = Date.now();
    const path = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
    const resp = await fetchGithubApi(path, { textLimit: 2048 });
    if (!resp.ok || !resp.data || resp.data._nonJson) {
      let msg = null;
      if (resp.data && !resp.data._nonJson && typeof resp.data.message === 'string') msg = resp.data.message;
      return errResult('fetch_failed', {
        httpStatus: resp.httpStatus || null,
        url: resp.url || null,
        message: msg,
        body: resp.data && resp.data.text ? { text: resp.data.text, truncated: !!resp.data.truncated } : null,
      });
    }
    const summary = summarizeRepoApi(resp.data);
    return okResult({
      owner,
      repo,
      repoSummary: summary,
      meta: {
        bridge: 'repo-bridge',
        version: VERSION,
        endpoint: resp.url,
        httpStatus: resp.httpStatus,
        fetchDurationMs: Date.now() - t0,
      },
    });
  }

  function navigateRepo(args){
    args = args || {};
    let { owner, repo } = normalizeOwnerRepoArgs(args);
    if (!owner || !repo) {
      const rp = parseRepoRootPath(location.pathname || '');
      owner = rp.owner || '';
      repo = rp.repo || '';
    }
    owner = String(owner).trim();
    repo = String(repo).trim();
    if (!owner || !repo) return errResult('missing_owner_repo');
    const url = 'https://github.com/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/';
    return navigateLocation(url);
  }

  const api = {
    __meta: { version: VERSION, name: 'repo-bridge' },
    probe,
    state,
    sessionState,
    getRepo,
    navigateRepo,
  };
  window.__jse_github_repo__ = api;
  return { ok: true, version: VERSION, name: 'repo-bridge' };
})();
