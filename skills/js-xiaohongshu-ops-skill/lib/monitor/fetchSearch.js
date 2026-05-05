'use strict';

/**
 * monitor fetchSearch - 跑 xhs_search_notes 抓关键词搜索。
 */

const { runTool } = require('../runTool');
const { buildSearchUrl } = require('../xhsUtils');

async function fetchSearch(browser, settings, options = {}) {
  const keyword = settings.keyword;
  try {
    const resp = await runTool(browser, {
      toolName: 'xhs_monitor_search',
      pageKey: 'search',
      method: 'search',
      cmdDef: { methodBase: 'search', domSupported: true, apiSupported: false, defaultReadMode: 'dom' },
      args: {
        keyword,
        limit: settings.limit || 10,
        channelType: settings.channelType || '全部',
        sortBy: settings.sortBy,
        contentType: settings.contentType,
        timeRange: settings.timeRange,
        searchScope: settings.searchScope,
        extractDetails: settings.extractDetails === true,
        detailsLimit: settings.detailsLimit ? Number(settings.detailsLimit) : undefined,
      },
      targetUrl: buildSearchUrl({ keyword }),
      options: {
        wsEndpoint: options.wsEndpoint || undefined,
        recording: options.recording,
        verbose: !!options.verbose,
        navigateOnReuse: true,
        reuseAnyXhsTab: true,
        timeoutMs: settings.extractDetails === true ? 360000 : 240000,
      },
    });
    const notes = (resp && resp.result && Array.isArray(resp.result.notes)) ? resp.result.notes : [];
    return {
      ok: !!resp.ok,
      keyword,
      notes,
      meta: { runId: resp.run?.id || null, durationMs: resp.run?.durationMs || null, antiCrawlState: resp.antiCrawlState || null },
      error: resp.ok ? null : (resp.error || null),
    };
  } catch (err) {
    return { ok: false, keyword, notes: [], meta: null, error: { message: err.message, code: err.code || null } };
  }
}

module.exports = { fetchSearch };
