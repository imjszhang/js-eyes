// bridges/issues-bridge.js
(function install(){
  'use strict';
  const VERSION = '0.1.0';

  // @@include ./common.js

  const DEFAULT_PER_PAGE = 25;
  const MAX_PER_PAGE = 100;
  const ALLOWED_STATE = new Set(['open', 'closed', 'all']);

  async function probe(){
    const p = parseIssuesListPath(location.pathname || '');
    const login = readLoginMeta();
    return okResult({
      url: location.href,
      owner: p.owner,
      repo: p.repo,
      login: { loggedIn: !!login.loggedIn, name: login.name, source: login.source },
      timestamp: new Date().toISOString(),
      bridge: { version: VERSION, name: 'issues-bridge' },
    });
  }

  async function state(){
    const p = parseIssuesListPath(location.pathname || '');
    return okResult({
      ready: !!(p.owner && p.repo),
      reason: (p.owner && p.repo) ? null : 'not_on_issues_list',
      url: location.href,
      owner: p.owner,
      repo: p.repo,
      bridgeVersion: VERSION,
    });
  }

  function sessionState(){ return sessionStateCommon(); }

  async function listIssues(args){
    args = args || {};
    let { owner, repo } = normalizeOwnerRepoArgs(args);
    if (!owner || !repo) {
      const p = parseIssuesListPath(location.pathname || '');
      owner = owner || p.owner || '';
      repo = repo || p.repo || '';
    }
    owner = String(owner).trim();
    repo = String(repo).trim();
    if (!owner || !repo) return errResult('missing_owner_repo', { hint: '传 owner+repo 或在 /<owner>/<repo>/issues 页执行' });

    const stateArg = args.state != null ? String(args.state).toLowerCase() : 'open';
    const state = ALLOWED_STATE.has(stateArg) ? stateArg : 'open';
    const perPage = clampLimit(args.perPage || args.limit, DEFAULT_PER_PAGE, MAX_PER_PAGE);
    const page = clampLimit(args.page, 1, 50);
    const excludePulls = args.excludePulls !== false;

    const usp = new URLSearchParams();
    usp.set('state', state);
    usp.set('per_page', String(perPage));
    usp.set('page', String(page));
    const path = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/issues?' + usp.toString();

    const t0 = Date.now();
    const resp = await fetchGithubApi(path, { textLimit: 4096 });
    if (!resp.ok || !resp.data || resp.data._nonJson) {
      let msg = null;
      if (resp.data && !resp.data._nonJson && typeof resp.data.message === 'string') msg = resp.data.message;
      return errResult('fetch_failed', {
        httpStatus: resp.httpStatus || null,
        url: resp.url || null,
        message: msg,
      });
    }
    if (!Array.isArray(resp.data)) {
      return errResult('unexpected_response', { hint: 'expected_json_array' });
    }

    let items = resp.data.map(summarizeIssueListItem).filter(Boolean);
    if (excludePulls) items = items.filter((x) => !x.isPullRequest);

    return okResult({
      owner,
      repo,
      state,
      page,
      requestedPerPage: perPage,
      excludePulls,
      returnedCount: items.length,
      items,
      meta: {
        bridge: 'issues-bridge',
        version: VERSION,
        endpoint: resp.url,
        httpStatus: resp.httpStatus,
        fetchDurationMs: Date.now() - t0,
      },
    });
  }

  function navigateIssues(args){
    args = args || {};
    let { owner, repo } = normalizeOwnerRepoArgs(args);
    if (!owner || !repo) {
      const p = parseIssuesListPath(location.pathname || '');
      owner = p.owner || '';
      repo = p.repo || '';
    }
    owner = String(owner).trim();
    repo = String(repo).trim();
    if (!owner || !repo) return errResult('missing_owner_repo');
    let url = 'https://github.com/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/issues';
    const q = args.q != null ? String(args.q).trim() : '';
    if (q) url += '?q=' + encodeURIComponent(q);
    return navigateLocation(url);
  }

  const api = {
    __meta: { version: VERSION, name: 'issues-bridge' },
    probe,
    state,
    sessionState,
    listIssues,
    navigateIssues,
  };
  window.__jse_github_issues__ = api;
  return { ok: true, version: VERSION, name: 'issues-bridge' };
})();
