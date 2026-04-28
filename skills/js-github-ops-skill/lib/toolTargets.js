'use strict';

function parseSlug(slug){
  const s = String(slug || '').trim();
  if (!s.includes('/')) return { owner: '', repo: '' };
  const parts = s.split('/').filter(Boolean);
  return { owner: parts[0] || '', repo: parts[1] || '' };
}

function repoRootUrl(args) {
  args = args || {};
  const owner = args.owner || '';
  const repo = args.repo || '';
  if (owner && repo) return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const { owner: o, repo: r } = parseSlug(args.slug || args.ownerRepo);
  if (o && r) return `https://github.com/${encodeURIComponent(o)}/${encodeURIComponent(r)}`;
  return 'https://github.com/';
}

function issuesListUrl(args) {
  args = args || {};
  const owner = args.owner || '';
  const repo = args.repo || '';
  let base = '';
  if (owner && repo) base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
  else {
    const { owner: o, repo: r } = parseSlug(args.slug || args.ownerRepo);
    if (o && r) base = `https://github.com/${encodeURIComponent(o)}/${encodeURIComponent(r)}/issues`;
  }
  if (!base) return 'https://github.com/';
  const q = args.q != null ? String(args.q) : '';
  return q ? `${base}?q=${encodeURIComponent(q)}` : base;
}

function issueDetailUrl(args) {
  args = args || {};
  const owner = args.owner || '';
  const repo = args.repo || '';
  let n = args.number != null ? Number(args.number) : NaN;
  if (owner && repo && Number.isFinite(n)) {
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${Math.floor(n)}`;
  }
  const { owner: o, repo: r } = parseSlug(args.slug || args.ownerRepo);
  if (o && r && Number.isFinite(n)) {
    return `https://github.com/${encodeURIComponent(o)}/${encodeURIComponent(r)}/issues/${Math.floor(n)}`;
  }
  return 'https://github.com/';
}

module.exports = {
  parseSlug,
  repoRootUrl,
  issuesListUrl,
  issueDetailUrl,
};
