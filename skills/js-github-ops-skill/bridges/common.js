// bridges/common.js
// ---------------------------------------------------------------------------
// 纯浏览器代码。通过 // @@include ./common.js 注入各 bridge。
// READ 数据走 https://api.github.com（GitHub 官方 REST，浏览器 CORS 允许匿名读公开资源）。
// ---------------------------------------------------------------------------

function clampLimit(value, defaultValue, maxValue){
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(Math.floor(n), maxValue);
}

function shortText(value, maxLen){
  const text = String(value == null ? '' : value);
  const limit = clampLimit(maxLen, 2000, 20000);
  if (text.length <= limit) return { text, truncated: false, length: text.length };
  return { text: text.slice(0, limit), truncated: true, length: text.length };
}

async function fetchGithubApi(path, options){
  options = options || {};
  const p = path && path.charAt(0) === '/' ? path : '/' + String(path || '');
  const url = 'https://api.github.com' + p;
  let res = null;
  let data = null;
  try {
    res = await fetch(url, {
      method: options.method || 'GET',
      credentials: 'omit',
      headers: Object.assign({
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }, options.headers || {}),
      redirect: 'follow',
    });
    const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (/json/i.test(contentType)) {
      data = await res.json();
    } else {
      const snippet = shortText(await res.text(), options.textLimit || 2000);
      data = {
        _nonJson: true,
        contentType,
        text: snippet.text,
        truncated: snippet.truncated,
        length: snippet.length,
      };
    }
  } catch (e) {
    return { ok: false, error: 'network_error', message: String((e && e.message) || e), url };
  }
  return { ok: !!(res && res.ok), httpStatus: res ? res.status : null, url, data };
}

function readLoginMeta(){
  try {
    const meta = document.querySelector('meta[name="user-login"]');
    const content = meta && meta.getAttribute('content');
    if (content && String(content).trim() && String(content).trim() !== '') {
      return { loggedIn: true, name: String(content).trim(), source: 'meta-user-login' };
    }
  } catch (_) {}
  return { loggedIn: false, name: null, source: 'none' };
}

function parseRepoRootPath(pathname){
  const m = /^\/([^/]+)\/([^/]+)\/?$/.exec(pathname || '');
  if (!m) return { owner: null, repo: null };
  return { owner: m[1], repo: m[2] };
}

function parseIssuesListPath(pathname){
  const m = /^\/([^/]+)\/([^/]+)\/issues\/?$/.exec(pathname || '');
  if (!m) return { owner: null, repo: null };
  return { owner: m[1], repo: m[2] };
}

function parseIssueDetailPath(pathname){
  const m = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(pathname || '');
  if (!m) return { owner: null, repo: null, number: null };
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

function normalizeOwnerRepoArgs(args){
  args = args || {};
  let owner = String(args.owner || '').trim();
  let repo = String(args.repo || '').trim();
  const pair = String(args.slug || args.ownerRepo || '').trim();
  if ((!owner || !repo) && pair.includes('/')) {
    const parts = pair.split('/').filter(Boolean);
    owner = owner || parts[0] || '';
    repo = repo || parts[1] || '';
  }
  return { owner, repo };
}

async function sessionStateCommon(){
  const meta = readLoginMeta();
  return okResult({
    loggedIn: !!meta.loggedIn,
    name: meta.name || null,
    source: meta.source,
    url: location.href,
    timestamp: new Date().toISOString(),
  });
}

function navigateLocation(targetUrl){
  const fromUrl = location.href;
  if (typeof targetUrl !== 'string' || !targetUrl) {
    return errResult('missing_target_url');
  }
  let parsed;
  try { parsed = new URL(targetUrl, location.href); } catch (_) {
    return errResult('invalid_target_url', { targetUrl });
  }
  if (!/(?:^|\.)github\.com$/i.test(parsed.hostname)) {
    return errResult('cross_origin_navigation_forbidden', { hostname: parsed.hostname });
  }
  const to = parsed.toString();
  if (to === fromUrl) {
    return okResult({ noop: true, from: { url: fromUrl }, to: { url: to }, hint: 'already_at_target' });
  }
  try {
    location.assign(to);
  } catch (e) {
    return errResult('location_assign_threw', { message: String((e && e.message) || e), from: { url: fromUrl }, to: { url: to } });
  }
  return okResult({ noop: false, from: { url: fromUrl }, to: { url: to }, hint: 'page_will_reload' });
}

function summarizeRepoApi(d){
  if (!d || typeof d !== 'object') return null;
  return {
    id: typeof d.id === 'number' ? d.id : null,
    name: typeof d.name === 'string' ? d.name : null,
    fullName: typeof d.full_name === 'string' ? d.full_name : null,
    description: typeof d.description === 'string' ? d.description : null,
    defaultBranch: typeof d.default_branch === 'string' ? d.default_branch : null,
    stars: typeof d.stargazers_count === 'number' ? d.stargazers_count : null,
    forks: typeof d.forks_count === 'number' ? d.forks_count : null,
    openIssues: typeof d.open_issues_count === 'number' ? d.open_issues_count : null,
    language: typeof d.language === 'string' ? d.language : null,
    htmlUrl: typeof d.html_url === 'string' ? d.html_url : null,
    homepage: typeof d.homepage === 'string' ? d.homepage : null,
    isPrivate: !!d.private,
    pushedAt: typeof d.pushed_at === 'string' ? d.pushed_at : null,
    createdAt: typeof d.created_at === 'string' ? d.created_at : null,
    topics: Array.isArray(d.topics) ? d.topics.slice(0, 30) : [],
  };
}

function summarizeIssueListItem(it){
  if (!it || typeof it !== 'object') return null;
  const isPr = !!(it.pull_request && typeof it.pull_request === 'object');
  return {
    number: typeof it.number === 'number' ? it.number : null,
    title: typeof it.title === 'string' ? it.title : null,
    state: typeof it.state === 'string' ? it.state : null,
    htmlUrl: typeof it.html_url === 'string' ? it.html_url : null,
    userLogin: it.user && typeof it.user.login === 'string' ? it.user.login : null,
    isPullRequest: isPr,
    createdAt: typeof it.created_at === 'string' ? it.created_at : null,
    updatedAt: typeof it.updated_at === 'string' ? it.updated_at : null,
  };
}

function summarizeIssueDetail(it, bodyMaxLen){
  if (!it || typeof it !== 'object') return null;
  const bodyRaw = typeof it.body === 'string' ? it.body : '';
  const bodySlice = shortText(bodyRaw, bodyMaxLen || 12000);
  const isPr = !!(it.pull_request && typeof it.pull_request === 'object');
  return {
    number: typeof it.number === 'number' ? it.number : null,
    title: typeof it.title === 'string' ? it.title : null,
    state: typeof it.state === 'string' ? it.state : null,
    htmlUrl: typeof it.html_url === 'string' ? it.html_url : null,
    userLogin: it.user && typeof it.user.login === 'string' ? it.user.login : null,
    isPullRequest: isPr,
    createdAt: typeof it.created_at === 'string' ? it.created_at : null,
    updatedAt: typeof it.updated_at === 'string' ? it.updated_at : null,
    labels: Array.isArray(it.labels)
      ? it.labels.map((l) => (l && typeof l.name === 'string' ? l.name : null)).filter(Boolean).slice(0, 40)
      : [],
    body: bodySlice.text,
    bodyTruncated: bodySlice.truncated,
    bodyLength: bodySlice.length,
  };
}

function okResult(data){ return { ok: true, data }; }
function errResult(error, extra){ return Object.assign({ ok: false, error: String(error) }, extra || {}); }
