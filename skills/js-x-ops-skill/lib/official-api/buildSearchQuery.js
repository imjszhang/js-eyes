'use strict';

const { buildFullQuery } = require('../../scripts/x-search');

function dateToStartTime(dateStr) {
  const clean = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  return `${clean}T00:00:00Z`;
}

function dateToEndTime(dateStr) {
  const clean = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  return `${clean}T23:59:59Z`;
}

function buildSearchQueryOptions(opts = {}) {
  const keyword = String(opts.keyword || opts.query || '').trim();
  const filterOpts = {
    from: opts.from,
    to: opts.to,
    since: opts.since,
    until: opts.until,
    lang: opts.lang,
    minLikes: opts.minLikes,
    minRetweets: opts.minRetweets,
    minReplies: opts.minReplies,
    excludeReplies: opts.excludeReplies,
    excludeRetweets: opts.excludeRetweets,
    hasLinks: opts.hasLinks,
  };

  const fullQuery = buildFullQuery(keyword, filterOpts);

  let startTime = opts.startTime || null;
  let endTime = opts.endTime || null;

  if (!startTime && opts.since && !String(fullQuery).includes('since:')) {
    startTime = dateToStartTime(opts.since);
  }
  if (!endTime && opts.until && !String(fullQuery).includes('until:')) {
    endTime = dateToEndTime(opts.until);
  }

  return {
    keyword,
    fullQuery,
    startTime,
    endTime,
    maxResults: opts.maxResults,
    maxPages: opts.maxPages,
    nextToken: opts.nextToken,
    sortOrder: opts.sortOrder,
    scope: opts.scope || 'all',
  };
}

module.exports = {
  buildSearchQueryOptions,
  dateToStartTime,
  dateToEndTime,
};
